var DataPlugger = require('dataplugger');
var fs = require('fs');
var _ = require('underscore');
var Download = require('download');
var async = require('async');
var Papa = require('papaparse');

var attachmentRegex = /https?:\/\/fieldbook.com\/attachments/g;
var defaultOpts = {
    dataPath : 'data.json',
    mediaPath : './media/',
    csvPath : false,
    skipExistingFiles : true,
    prettifyJson : false
};
var opts = {};

function getBook(bookId, cb) {
    var dataplugger = new DataPlugger({
        'fieldbook' : {
            book : bookId
        }
    });

    dataplugger.setDefaultPlug('fieldbook');

    dataplugger.load(cb);
}

function fileExists(filename, cb) {
    if (!opts.skipExistingFiles) {
        cb(false);
        return;
    }

    fs.stat(filename, (err, stat) => {
        if (err === null) {
            cb(true);
        } else if (err.code === 'ENOENT') {
            cb(false);
        } else {
            throw err;
        }
    });
}

function downloadMediaFromRecords(records, finalCallback) {
    var downloads = [];

    console.log("Downloading media records");

    records.forEach((record) => {
        _.each(record, (val, key) => {
            if (attachmentRegex.test(val)) {
                downloads.push(function(callback) {
                    var filename = val.split('/').slice(-2).join('-');

                    fileExists(opts.mediaPath + filename, (exists) => {
                        if (!exists) {
                            new Download().get(val).dest(opts.mediaPath).rename(filename).run(() => {
                                console.log("Downloaded " + filename);
                                callback();
                            });
                        } else {
                            console.log("Skipping file, exists: " + filename);
                            callback();
                        }

                        record[key] = 'media/' + filename;
                    });
                });
            }
        });
    });

    console.log(downloads.length + " images found");

    async.parallel(downloads, finalCallback);
}

function downloadCsv(sheet, id) {
    var csv = Papa.unparse(sheet);
    var path = opts.csvPath + id + '.csv';
    fs.writeFile(path, csv, 'utf-8', () => console.log('Downloaded ' + path));
}

function stringifyJson(data) {
    if (opts.prettifyJson) {
        return JSON.stringify(data, null, 4);
    } else {
        return JSON.stringify(data);
    }
}

function download(userOpts) {
    opts = _.extend(defaultOpts, userOpts);

    console.log("Getting " + opts.bookId);

    getBook(opts.bookId, (book) => {
        console.log("Got book");

        if (opts.csvPath) {
            _.each(book, downloadCsv);
        }

        async.each(_.values(book), downloadMediaFromRecords, () => {
            fs.writeFile(opts.dataPath, stringifyJson(book), 'utf-8', () => {
                console.log("Written JSON file at " + opts.dataPath);
                opts.callback();
            });
        });
    });
}

module.exports = download;