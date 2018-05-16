var atdownload = require('./airtable-download');

atdownload({
    baseId: 'appmLNhw9FR8YeN0M',
    apiKey: 'keyqG8OTabXl8GpPI',
    dataPath: './data/data.json',
    mediaPath: './media/', // This is used for saving the file
    mediaBookPath: 'media/', // And this is used for replacing
    csvPath: false,//'./data/',
    skipExistingFiles: true,
    prettifyJson: true,

    // This can be used to upload / migrate images from 1 field to another

    /* updateAttachments:{
         filesrc: 'imagesrc',
         filetarget: 'image',
         table: 'blocks'
     },
    */

    tables: [
        'meta',
        'blocks'
    ],
    callback: function () {
        console.log('this is ready');
    }
});