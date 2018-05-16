const fs = require('fs');
const Download = require('download');
const async = require('async');
const Papa = require('papaparse');

const attachmentRegex = /https?:\/\/dl.airtable.com/;
const MEDIA_URL_KEY = '$mediaUrl$';
const MEDIA_FILENAME_KEY = '$mediaFilename$';

const defaultOpts = {
    dataPath: 'data.json',
    mediaPath: './media/', // This is used for saving the file
    mediaBookPath: 'media/', // And this is used for replacing
    csvPath: false,
    skipExistingFiles: true,
    prettifyJson: false,
};

class AirtableDownload {

    constructor(baseId, apiKey, opts) {
        this.baseId = baseId;
        this.apiKey = apiKey;
        this.opts = Object.assign({}, defaultOpts, opts);
        this.media = [];
        this.book = {};
        this.tableIndex = 0;
        this.tables = opts.tables;
        this.tableCount = opts.tables.length;
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
        if (field && field.length && field.length > 0 && field[0].thumbnails) {
            let val;
            let externalUrl = val = field[0].url;

            if (!attachmentRegex.test(val)) {
                return val;
            }

            // We've got a media attachment, transform to something
            // new, and add the old url to the book
            const filename = externalUrl.split('/').slice(-1);
            const localPath = `${this.opts.mediaPath}${filename}`;
            const localBookPath = `${this.opts.mediaBookPath}${filename}`;

            this.media.push({
                externalUrl, filename, localPath, localBookPath
            });

            return localBookPath;
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

    downloadCsv(book) {
        for (let key in book) {
            let sheet = book[key];
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

    writeBook() {
        let bookJson = this.stringifyJson(this.book);

        return new Promise((resolve, reject) => {
            fs.writeFile(this.opts.dataPath, bookJson, 'utf-8', (err, written) => {
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
        this.Airtable = require('airtable');
        this.Airtable.configure({
            endpointUrl: 'https://api.airtable.com',
            apiKey: this.apiKey
        });
        this.base = this.Airtable.base(this.baseId);

        console.log(`Getting ${this.baseId} -> ${this.tableCount} tables`);

        //loop through all tables in base / options object
        this.tables.forEach(table => {
            let data = [];
            let basetable = this.base(table);
            let that = this;

            basetable.select({
                view: "Grid view",

            }).eachPage(function page(records, fetchNextPage) {

                // This function (`page`) will get called for each page of records.
                records.forEach(record => {
                    let fields = {};

                    for (let field in record.fields) {
                        fields[field] = that.parseFiles(record.fields[field]);

                        //add internal ID if not present in table fields
                        if (!fields.id) {
                            fields.id = record.id;
                        }
                    }
                    ;
                    if (that.opts.addCreatedTime) {
                        fields.createdTime = record._rawJson.createdTime;
                    }

                    // upload attachments to airtable
                    if (that.opts.updateAttachments && table === that.opts.updateAttachments.table) {
                        let fileSrc = that.opts.updateAttachments.filesrc;
                        let fileTarget = that.opts.updateAttachments.filetarget;


                        let newItemObj = fields;
                        delete fields.id;
                        if (fields[fileSrc]) {

                            newItemObj[fileTarget] = [
                                {
                                    "url": fields[fileSrc]
                                }
                            ];

                            basetable.replace(record.id, newItemObj, function (err, record) {
                                if (err) {
                                    console.error(err);
                                    return;
                                }
                                console.log(record.get('type'));
                            });
                        }
                    }

                    data.push(fields);
                });

                // To fetch the next page of records, call `fetchNextPage`.
                // If there are more records, `page` will get called again.
                // If there are no more records, `done` will get called.
                fetchNextPage();

            }, function done(err) {
                that.book[table] = data;
                that.tableIndex++;
                console.log('done fetching table ', table);

                // When all tables have been fetched an parsed,
                // output JSON, CSV files and download media
                if (that.tableIndex >= that.tableCount) {
                    that.writeBook(that.book);

                    if (that.opts.csvPath) {
                        that.downloadCsv(that);
                    }

                    that.downloadMedia()
                        .then(that.opts.callback);

                }
                if (err) {
                    console.error(err);
                    return;
                }
            });
        });

    }
};

module.exports = function (opts) {
    const atdownload = new AirtableDownload(opts.baseId, opts.apiKey, opts);
    atdownload.start();
}