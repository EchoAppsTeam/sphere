module.exports = function(grunt) {
	"use strict";

	var _ = require("lodash");

	grunt.registerTask("init-environment", "Create environment configuration files", function() {
		var options = this.options({
			"list": ["development", "test", "staging", "production"],
			"configDir": "config/environments",
			"cleanup": function(cfg) {
				return cfg;
			}
		});
		var noValue = [];
		var merge = function(value, oldValue, keyString) {
			if (value === "") {
				// let's use the value from already existing config file if we have one
				if (!_.isUndefined(oldValue) && oldValue !== "[PLACEHOLDER]") {
					return oldValue;
				} else {
					noValue.push(keyString.substring(1));
					return "[PLACEHOLDER]";
				}
			} else if (_.isArray(value)) {
				if (_.isUndefined(oldValue)) oldValue = [];
				return _.map(value, function(v, i) {
					return merge(v, oldValue[i], keyString + "." + i);
				});
			} else if (_.isObject(value)) {
				if (_.isUndefined(oldValue)) oldValue = {};
				return _.reduce(value, function(acc, v, k) {
					acc[k] = merge(v, oldValue[k], keyString + "." + k);
					return acc;
				}, {});
			} else {
				return value;
			}
		};
		var sample = grunt.file.readJSON(options.configDir + "/sample.json");
		_.each(options.list, function(env) {
			var filename = options.configDir + "/" + env + ".json";
			var oldCfg = grunt.file.exists(filename) ? grunt.file.readJSON(filename) : {};
			var newCfg = options.cleanup(_.cloneDeep(sample), env);

			noValue = [];
			// merge in the values from already existing config file leaving
			// only new fields unfilled and removing obsolete fields
			newCfg = merge(newCfg, oldCfg, "");
			if (noValue.length) {
				grunt.log.writeln(filename.cyan + ": " + ("fill in the following fields:\n\t" + noValue.join("\n\t")).yellow);
			}
			grunt.file.write(filename, JSON.stringify(newCfg, null, "\t"));
		});
	});

	grunt.registerTask("check-environment", "Check environment configuration files", function(name) {
		var options = this.options({
			"list": ["development", "test", "staging", "production"],
			"configDir": "config/environments"
		});
		var failed = false;
		var error = function(msg, solution) {
			failed = true;
			solution = solution === "init"
				? " (execute `grunt init-environment`)"
				: (solution === "fill-in"
					? " (find [PLACEHOLDER] string and replace it with the corresponding value)"
					: ""
				);
			grunt.log.writeln(msg.red + solution.grey);
		};
		var sample = grunt.file.readJSON(options.configDir + "/sample.json");
		var check = function(env) {
			var filename = options.configDir + "/" + env + ".json";
			grunt.log.write("Checking " + filename.cyan + " ... ");
			if (!grunt.file.exists(filename)) {
				error("absent", "init");
				return;
			}
			var cfg = grunt.file.readJSON(filename);
			if (_.isEmpty(cfg)) {
				error("absent", "init");
				return;
			}
			if (sample.version > cfg.version) {
				error("outdated", "init");
				return;
			}
			var content = grunt.file.read(filename);
			if (content.indexOf("[PLACEHOLDER]") !== -1) {
				error("not ready", "fill-in");
				return;
			}
			grunt.log.ok();
		};
		if (name && _.contains(options.list, name)) {
			check(name);
		} else {
			_.each(options.list, check);
		}
		return !failed;
	});
};
