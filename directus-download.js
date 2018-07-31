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
    depth: 10
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

    parseFiles(field) {
        if (
            field &&
            field.meta &&
            field.meta.table &&
            field.meta.table === "directus_files"
            && field.meta.type === "item"
            && field.data.url
        ) {
            let url = field.data.url;
            let externalUrl = this.opts.baseUrl + url;

            const filename = field.data.name;
            const localPath = `${this.opts.mediaPath}${filename}`;
            const localBookPath = `${this.opts.mediaBookPath}${filename}`;

            this.media.push({
                externalUrl, filename, localPath, localBookPath
            });

            //set image url to local path
            field.data.url = localBookPath;

            //@todo: add thumbnail downloads

            if (this.opts.useImageObjects || this.opts.fieldbookCompatible) {
                return field;
            }
            else {
                return localBookPath;
            }
        }
        else {
            return field;
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
            depth: this.opts.depth
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
                                        console.log('subsubfields', subchild[subsubfield]);

                                        this.parseFiles(child[childfield]);
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
                    fields[field] = this.parseFiles(res.data[field]);
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