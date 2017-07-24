const DataPlugger = require('dataplugger');
const fs = require('fs');
const Download = require('download');
const async = require('async');
const Papa = require('papaparse');

const attachmentRegex = /https?:\/\/fieldbook.com\/attachments/;

const defaultOpts = {
    dataPath : 'data.json',
    mediaPath : './media/',
    csvPath : false,
    skipExistingFiles : true,
    prettifyJson : false
};

class FieldbookDownload {
    constructor(bookId, opts) {
        this.bookId = bookId;
        this.opts = Object.assign({}, defaultOpts, opts);
    }

    getBook(callback) {
        const dataplugger = new DataPlugger({
            'fieldbook' : {
                book : this.bookId
            }
        });

        dataplugger.setDefaultPlug('fieldbook');

        dataplugger.load(callback);
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

    downloadMediaFromBook(book, callback) {
        let downloads = [];

        for (let key in book) {
            let sheet = book[key];

            console.log(`Going to download sheet ${key}`);

            downloads.push((downloadCallback) => {
                this.downloadMediaFromSheet(sheet, downloadCallback);
            });
        }

        async.parallel(downloads, () => {
            callback(book);
        });
    }

    downloadMediaFromSheet(sheet, callback) {
        let downloads = [];

        for (let record of sheet) {
            for (let key in record) {
                let val = record[key];

                if (!attachmentRegex.test(val)) {
                    continue;
                }

                const externalUrl = val;
                const filename = externalUrl.split('/').slice(-2).join('-');
                const localPath = `${this.opts.mediaPath}${filename}`;

                // Replace the filename in the sheet as well
                console.log(`New media path for ${key}: '${localPath}'`);
                record[key] = localPath;

                downloads.push((downloadCallback) => {
                    this.fileExists(localPath, (pathExists) => {
                        if (pathExists) {
                            console.log(`Skipping ${filename}, exists`);
                            downloadCallback();
                        } else {
                            console.log(`Going to download ${externalUrl}`);

                            new Download().
                                get(externalUrl).
                                dest(this.opts.mediaPath).
                                rename(filename).
                                run(() => {
                                    console.log(`Downloaded '${externalUrl}'`);
                                    downloadCallback();
                                });
                        }
                    });
                });
            }
        }

        console.log(`Going to download ${downloads.length} images`);

        async.parallel(downloads, () => {
            callback(sheet);
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

    writeBook(book, callback) {
        let bookJson = this.stringifyJson(book);

        fs.writeFile(this.opts.dataPath, bookJson, 'utf-8', () => {
            console.log(`Written JSON file at ${this.opts.dataPath}`);
            callback();
        });
    }

    start() {
        console.log(`Getting ${this.bookId}`);

        this.getBook((book) => {
            console.log("Got book");

            if (this.opts.csvPath) {
                this.downloadCsv(book);
            }

            this.downloadMediaFromBook(book, (modifiedBook) => {
                this.writeBook(modifiedBook, this.opts.callback);
            });
        });
    }
};

module.exports = function(opts) {
    const fbdownload = new FieldbookDownload(opts.bookId, opts);
    fbdownload.start();
}