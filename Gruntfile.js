module.exports = function(grunt) {
	"use strict";

	var jscs = require("jscs/lib/utils");

	grunt.loadNpmTasks("grunt-contrib-jshint");
	grunt.loadNpmTasks("grunt-newer");
	grunt.loadNpmTasks("grunt-jscs");

	grunt.registerTask("default", ["newer:jshint", "newer:jscs"]);

	grunt.initConfig({
		"jshint": {
			"options": {
				"jshintrc": ".jshintrc"
			},
			"all": {
				"src": ["Gruntfile.js", "tasks/*"]
			}
		},
		"jscs": {
			"options": {
				"preset": "google",
				"validateIndentation": "\t",
				"validateQuoteMarks": "\"",
				// value "true" for this parameter requires ternary operator symbols (? & :)
				// to be in the end of the line and not in the beginning,
				// let's not force the rule for this symbol but keep for all others in place
				"requireOperatorBeforeLineBreak": jscs.binaryOperators,
				"maximumLineLength": {
					"value": 100
				}
			},
			"all": "<%= jshint.all %>"
		}
	});
};
