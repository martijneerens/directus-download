let dsdownload = require('./directus-download');

dsdownload({
    dataPath: './test/data/data.json',
    mediaPath: './test/media/', // This is used for saving the file
    mediaBookPath: 'media/', // And this is used for replacing
    csvPath: false,
    prettifyJson: false,
    skipExistingFiles: true,
    useImageObjects: true, //return full directus file object instead of the url as a string only
    baseUrl: 'https://labs.volkskrant.nl',
    apiUrl: 'https://labs.volkskrant.nl/directus/',
    accessToken: false, // only required when requesting non-publically available endpoints
    downloadThumbnails: 800,
    order: 'desc',
    sort: 'id',
    items: [
        'alternatieve_reisgids' // when requesting all rows
    ],
    callback: function () {
        console.log('this is ready');
    }
});