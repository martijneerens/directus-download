module.exports = function (grunt) {
    // Load grunt tasks automatically
    require('load-grunt-tasks')(grunt);

    grunt.initConfig({
        bump : {
            options : {
                files : ['package.json'],
                pushTo : 'origin',
                commitFiles : ['-a']
            }
        }
    });
};