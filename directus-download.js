const fs = require('fs');
const Download = require('download');
const async = require('async');
const Papa = require('papaparse');
const RemoteInstance = require('directus-sdk-javascript/remote');

const attachmentRegex = /\/directus\/storage\/uploads\/\w+/g;

const defaultOpts = {
    dataPath: 'data.json',
    mediaPath: './media/', // This is used for saving the file
    mediaBookPath: 'media/', // And this is used for replacing
    useImageObjects: false, //return just the url for an image or
    items: [], //tables to be fetched from Directus API
    csvPath: false,
    fieldbookCompatible: false,
    baseUrl: '',
    apiUrl: '',
    accessToken: false,
    skipExistingFiles: true,
    prettifyJson: false,
    depth: 10,
    limit: 10000
};

class DirectusDownload {

    constructor(opts) {
        this.opts = Object.assign({}, defaultOpts, opts);
        this.media = [];
        this.data = {};
        this.itemIndex = 0;
        this.items = opts.items;
        this.itemCount = opts.items.length;
    }

    fileExists(filename, callback) {
        if (!this.opts.skipExistingFiles) {
            callback(false);
            return;
        }

        fs.stat(filename, (err, stat) => {
            if (err === null) {
                callback(true);
            } else if (err.code === 'ENOENT') {
                callback(false);
            } else {
                throw err;
            }
        });
    }

    findObjects(obj, targetProp, targetValue, finalResults) {

        function getObject(theObject) {
            let result = null;
            if (theObject instanceof Array) {
                for (let i = 0; i < theObject.length; i++) {
                    getObject(theObject[i]);
                }
            } else {
                for (let prop in theObject) {
                    if (theObject.hasOwnProperty(prop)) {
                        // console.log(prop + ': ' + theObject[prop]);
                        if (prop === targetProp) {
                            console.log('--found id');
                            if (theObject[prop] === targetValue) {
                                console.log('----found prop', prop, ', ', theObject[prop]);
                                finalResults.push(theObject);
                            }
                        }
                        if (theObject[prop] instanceof Object || theObject[prop] instanceof Array) {
                            getObject(theObject[prop]);
                        }
                    }
                }
            }
        }

        getObject(obj);

    }

    parseFiles(field) {
        if (
            field &&
            field.meta &&
            field.meta.table &&
            field.meta.table === "directus_files"
        ) {
            if(field.meta.type === "item" && field.data.url){
                return this.renameFile(field);
            }
            else if(field.meta.type === "collection"){
                if(field.data && field.data.length) {
                    console.log(`parse /${field.data.length} files!`);
                    for (let file in field.data) {
                        let subfile = this.renameFile(field.data[file]);
                    }
                }
                return field;
            }
        }
        else if(field && field.storage_adapter){
            return this.renameFile(field);
        }
        else {
            return field;
        }
    }

    renameFile(field){
        let url = field.url
        if(field.data && field.data.url) {
            url = field.data.url;
        }
        let externalUrl = this.opts.baseUrl + url;

        let filename;
        if(field.data && field.data.url) {
            filename = field.data.name;
        }
        else{
            filename = field.name;
        }


        const localPath = `${this.opts.mediaPath}${filename}`;
        const localBookPath = `${this.opts.mediaBookPath}${filename}`;

        this.media.push({
            externalUrl, filename, localPath, localBookPath
        });

        //set image url to local path
        if(field.data && field.data.url) {
            field.data.url = localBookPath;
        }
        else {
          field.url = localBookPath;
        }

        if (this.opts.useImageObjects || this.opts.fieldbookCompatible) {
            return field;
        }
        else {
            return localBookPath;
        }
    }

    downloadMedia() {
        let downloads = [];

        for (let media of this.media) {
            downloads.push((downloadCallback) => {
                this.fileExists(media.localPath, (pathExists) => {
                    if (pathExists) {
                        console.log(`Skipping ${media.filename}, exists`);
                        downloadCallback();
                    } else {
                        console.log(`Going to download ${media.externalUrl}`);

                        new Download().get(media.externalUrl).dest(this.opts.mediaPath).rename(media.filename).run(() => {
                            console.log(`Downloaded '${media.externalUrl}'`);
                            downloadCallback();
                        });
                    }
                });
            });
        }

        return new Promise((resolve) => {
            console.log(`Going to download ${downloads.length} images`);
            async.parallel(downloads, resolve);
        });
    }

    downloadCsv(item) {
        for (let key in item) {
            let sheet = item[key];
            const csv = Papa.unparse(sheet);
            const path = `${this.opts.csvPath}${key}.csv`;

            fs.writeFile(path, csv, 'utf-8', () => {
                console.log(`CSV downloaded: '${path}'`);
            });
        }
    }

    stringifyJson(data) {
        if (this.opts.prettifyJson) {
            return JSON.stringify(data, null, 4);
        } else {
            return JSON.stringify(data);
        }
    }

    writeJson() {
        let itemJson = this.stringifyJson(this.data);

        return new Promise((resolve, reject) => {
            fs.writeFile(this.opts.dataPath, itemJson, 'utf-8', (err, written) => {
                if (err) {
                    reject();
                } else {
                    console.log(`Written JSON file at ${this.opts.dataPath}`);
                    resolve();
                }
            });
        });
    }

    start() {
        let apiOpts = {
            url: this.opts.apiUrl,
            version: '1.1'
        }

        let params = {
            depth: this.opts.depth,
            limit: this.opts.limit
        }

        //only pass accesstoken when available in config
        if (this.opts.accessToken) {
            apiOpts.accessToken = this.opts.accessToken
        }

        this.client = new RemoteInstance(apiOpts);

        this.opts.items.forEach(item => {
            if (item.id && item.api) {
                console.log(`getItem /${item.api}/${item.id} as ${item.name}`);

                this.client.getItem(item.api, item.id, params)
                    .then(res => {
                        this.fetchComplete(res, item.name);
                    })
                    .catch(err => console.log(err));
            }
            else {
                console.log(`getItems /${item}`);

                this.client.getItems(item, params)
                    .then(res => {
                        this.fetchComplete(res, item);
                    })
                    .catch(err => console.log(err));
            }

        });
    }

    parseRecursiveFiles(fields) {
        console.log('level deeper');

        let data = {};
        for (let item in fields) {
            let field = fields[item];
            if (field.meta && field.meta.type && field.meta.type === 'collection') {
                data[item] = {
                    data: this.parseRecursiveFiles(field.data)
                }
            }
            else {
                if (field.data && field.data.length) {
                    let fielddata = [];
                    for (let child in field.data) {
                        fielddata.push(this.parseFiles(child));
                    }
                    data[item] = fielddata;
                }
                else {
                    data[item] = this.parseFiles(field);
                }
            }
        }
        return data;
    }

    fetchComplete(res, item) {
        let itemdata = [];
        let fields = {};

        //array of objects
        if (res.data.length) {

            res.data.forEach(record => {
                fields = {};
                for (let field in record) {
                    let subfields = record[field];

                    //check if this field is a nested collection
                    if (subfields && subfields.meta && subfields.meta.type && subfields.meta.type === 'collection') {
                        let childFields = [];
                        if (subfields.data.length) {
                            console.log(`fetch ${subfields.data.length} children in nested table `);
                        }
                        subfields.data.forEach(child => {
                            let childData = {};
                            for (let childfield in child) {
                                childData[childfield] = this.parseFiles(child[childfield]);

                                //look for subchildren
                                let subchild = child[childfield];

                                if (subchild && subchild.meta && subchild.meta.type && subchild.meta.type === 'collection') {
                                    console.log(`fetch ${subchild.data.length} in children of nested table`);
                                    for (let subsubfield in subchild) {
                                        let subchildData = {};
                                        this.parseFiles(child[childfield]);

                                        let subsubchild = subchild[subsubfield];

                                        if (subsubchild && subsubchild.meta && subsubchild.meta.type && subsubchild.meta.type === 'collection') {
                                            console.log('we have subsubchildren!', subsubchild.data.length);
                                        }
                                    }
                                }
                            }
                            ;
                            childFields.push(childData);

                        });
                        fields[field] = childFields;
                    }
                    else {
                        fields[field] = this.parseFiles(record[field]);
                    }

                }
                itemdata.push(fields);
            });
        }
        else {
            //single object
            if (this.opts.fieldbookCompatible) {
                console.log('is fieldbook compatible');
                fields = [];
            }

            for (let field in res.data) {

                if (this.opts.fieldbookCompatible) {
                    fields.push({
                        'key': field,
                        'value': this.parseFiles(res.data[field])
                    });
                }
                else {
                    if (res.data[field] && res.data[field].meta && res.data[field].meta.type && res.data[field].meta.type === 'collection') {
                        let childcontent = {};

                        for (let child in res.data[field].data) {
                            childcontent[child] = {};
                            let subchild = res.data[field].data[child];

                            for (let subsubchild in subchild) {
                                let subsubchildContent = subchild[subsubchild];
                                childcontent[child][subsubchild] = this.parseFiles(subsubchildContent);

                                // if (subsubchildContent && subsubchildContent.meta && subsubchildContent.meta.type && subsubchildContent.meta.type === 'collection' && subsubchildContent.data.length) {
                                //     console.log('we have subsubchildren!', subsubchildContent.data.length, ' :');
                                //     for (let subsubsubchild in subsubchildContent.data) {
                                //         let mysubchild = subsubchildContent.data[subsubsubchild];
                                //         console.log(mysubchild);
                                //     }
                                // }
                            }
                            childcontent[child] = this.parseFiles(res.data[field].data[child]);
                        }
                        fields[field] = {data: childcontent};
                    }
                    else fields[field] = this.parseFiles(res.data[field]);
                }

            }
            itemdata = fields;
        }


        this.data[item] = itemdata;
        this.itemIndex++;

        console.log('done fetching item', item);

        if (this.itemIndex >= this.itemCount) {
            this.allItemsProcessed(this.data);
        }
    }

    allItemsProcessed(data) {
        console.log('all data done!');
        this.writeJson(data);

        if (this.opts.csvPath) {
            this.downloadCsv(data);
        }

        this.downloadMedia()
            .then(this.opts.callback);

    }
};

module.exports = function (opts) {
    const dsdownload = new DirectusDownload(opts);
    dsdownload.start();
}