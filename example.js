var fbdownload = require('./fieldbook-download');

fbdownload({
    bookId : 'your-book-id-here',
    dataPath : 'data.json',
    mediaPath : './media/',
    callback : function() {
        console.log('ready');
    }
});