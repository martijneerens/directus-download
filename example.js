var dsdownload = require('./directus-download');

dsdownload({
    dataPath: './data/data.json',
    mediaPath: './media/', // This is used for saving the file
    mediaBookPath: 'media/', // And this is used for replacing
    csvPath: false,
    prettifyJson: false,
    skipExistingFiles: true,
    useImageObjects: false, //return full directus file object instead of the url as a string only
    baseUrl: '',
    apiUrl: '',
    accessToken: false, // only required when requesting non-publically available endpoints
    items: [
        {
            api: 'tablename', // pass an object when only requesting 1 item from a table
            id: 'id-here',
            name: 'alternatename'
        },
        'tablename' // when requesting all rows
    ],
    callback: function () {
        console.log('this is ready');
    }
});