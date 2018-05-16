const DataPlugger = require('dataplugger');
const fs = require('fs');
const Download = require('download');
const async = require('async');
const Papa = require('papaparse');

const attachmentRegex = /https?:\/\/dl.airtable.com/;
const MEDIA_URL_KEY = '$mediaUrl$';
const MEDIA_FILENAME_KEY = '$mediaFilename$';

const defaultOpts = {
    dataPath : 'data.json',
    mediaPath : './media/', // This is used for saving the file
    mediaBookPath : 'media/', // And this is used for replacing
    csvPath : false,
    skipExistingFiles : true,
    prettifyJson : false
};

class FieldbookDownload {
    constructor(bookId, opts) {
        this.bookId = bookId;
        this.opts = Object.assign({}, defaultOpts, opts);
        this.media = [];
        this.book = {};
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

    // Check for Fieldbook attachment links, transform them to local urls
    // and add a downloadable link to the book
    parseMedia(book) {
        this.book = book;

        // Can't we decrease these three loops someway?
        for (let sheetKey in book) {
            let sheet = book[sheetKey];

            for (let record of sheet) {
                for (let key in record) {
                    let val = record[key];

                    if (!attachmentRegex.test(val)) {
                        continue;
                    }

                    // We've got a media attachment, transform to something
                    // new, and add the old url to the book
                    const externalUrl = val;
                    const filename = externalUrl.split('/').slice(-2).join('-');
                    const localPath = `${this.opts.mediaPath}${filename}`;
                    const localBookPath = `${this.opts.mediaBookPath}${filename}`;

                    record[MEDIA_URL_KEY + key] = externalUrl;
                    record[MEDIA_FILENAME_KEY + key] = filename;
                    record[key] = localBookPath;

                    this.media.push({
                        externalUrl, filename, localPath, localBookPath
                    });
                }
            }
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

                        new Download().
                            get(media.externalUrl).
                            dest(this.opts.mediaPath).
                            rename(media.filename).
                            run(() => {
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
        console.log(`Getting ${this.bookId}`);

        this.getBook((book) => {
            console.log("Got book");

            if (this.opts.csvPath) {
                this.downloadCsv(book);
            }

            this.parseMedia(book);

            this.downloadMedia()
                .then(this.writeBook.bind(this))
                .then(this.opts.callback);
        });
    }
};

module.exports = function(opts) {
    const fbdownload = new FieldbookDownload(opts.bookId, opts);
    fbdownload.start();
}