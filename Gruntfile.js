module.exports = function(grunt) {
	"use strict";

	grunt.loadNpmTasks("grunt-contrib-jshint");
	grunt.loadNpmTasks("grunt-newer");

	grunt.registerTask("default", ["newer:jshint"]);

	grunt.initConfig({
		"jshint": {
			"options": {
				"jshintrc": ".jshintrc"
			},
			"all": {
				"src": ["Gruntfile.js", "tasks/*"]
			}
                }
	});
};
