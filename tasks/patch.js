module.exports = function(grunt) {
	"use strict";

	var _ = require("lodash");

	grunt.registerMultiTask("patch", "Patch project files", function() {
		var flags = this.flags;
		var patcher = this.options().patcher;
		if (!patcher || !_.isFunction(patcher)) {
			grunt.warn("Patcher is not defined or not a function");
			return;
		}
		this.filesSrc.forEach(function(filepath) {
			var src = grunt.file.read(filepath);
			src = patcher(src, filepath, flags);
			grunt.file.write(filepath, src);
			grunt.verbose.writeln("Patched file " + filepath.cyan);
		});
		grunt.log.writeln("Patched " + this.filesSrc.length.toString().cyan + " files");
	});
};
