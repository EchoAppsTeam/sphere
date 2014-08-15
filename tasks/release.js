module.exports = function(grunt) {
	"use strict";

	var FtpUploader = require("ftp-uploader");
	var _ = require("lodash");
	var Q = require("q");

	var release = {};

	grunt.registerMultiTask("release", "Release", function() {
		// don't let release everything at once
		_.each(grunt.cli.tasks, function(name) {
			if (name === "release") {
				grunt.fail.fatal(
					"Can't release everything at once. " +
					"Please choose only one of the following targets:\n\t" +
					_(grunt.config("release"))
						.keys()
						.filter(function(key) { return key !== "options"; })
						.value()
						.join("\n\t").cyan
				);
			}
		});

		var options = this.options({
			"purgeTitle": "manual purge",
			"purgePaths": [],
			"deployTargets": [],
			"beforeDeploy": [],
			"afterDeploy": [],
			"skipBuild": false,
			"skipPurge": false
		});
		if (!_.contains(["production", "staging"], options.environment)) {
			grunt.fail.fatal(
				"Release can be performed only in the \"production\" " +
				"and \"staging\" environment."
			);
		}

		if (options.configFile && grunt.file.exists(options.configFile)) {
			release.config = grunt.file.readJSON(options.configFile);
		} else {
			release.config = {};
		}
		if (_.isEmpty(release.config)) {
			grunt.fail.fatal("No release configuration so nothing to do.");
		}

		release.environment = options.environment;
		release.debug = options.debug;
		// save to config some indicator that release is in progress
		// to allow other tasks to know this fact
		grunt.config("release.options.inProgress", true);
		release.deploy = {
			"location": options.location,
			"targets": options.deployTargets
		};
		if (release.environment === "production") {
			release.purge = {
				"title": options.purgeTitle,
				"paths": options.purgePaths
			};
		}
		var tasks = ["release-steps:prepare", "release-steps:check:before"];
		if (!options.skipBuild) {
			tasks.unshift("release-steps:build");
		}
		tasks = tasks.concat(options.beforeDeploy);
		_.each(release.deploy.targets, function(v, target) {
			tasks.push("release-steps:deploy:" + target);
		});
		tasks = tasks.concat(options.afterDeploy);
		if (!options.skipPurge) {
			tasks.push("release-steps:purge");
		}
		tasks.push("release-steps:check:after");
		console.time("whole release".yellow);
		grunt.task.run(tasks);
	});

	grunt.registerTask("release-steps", function(action) {
		if (!grunt.config("release.options.inProgress")) {
			grunt.fail.fatal(
				"Release steps can't be executed separately " +
				"but only as a part of whole release process."
			);
		}
		var handler = function() {};
		if (action === "prepare") {
			handler = prepareRelease;
		} else if (action === "check") {
			if (this.args[1] === "before") {
				handler = preReleaseCheck;
			} else if (this.args[1] === "after") {
				handler = postReleaseCheck;
			}
		} else if (action === "build") {
			handler = build;
		} else if (action === "deploy") {
			handler = deploy;
		} else if (action === "purge") {
			handler = purge;
		}

		var task = this.args.join(":");
		task && console.time(task.yellow);
		var _complete = this.async();
		var done = function(success) {
			task && console.timeEnd(task.yellow);
			if (task === "check:after") {
				console.timeEnd("whole release".yellow);
			}
			_complete(success);
		};
		handler.call(this, done);
	});

	function build(done) {
		grunt.task.run(["default"]);
		done();
	}

	function prepareRelease(done) {
		release.deploy.data = _.reduce(
			release.deploy.targets,
			function(acc, upload, target) {
				acc[target] = {
					"src": grunt.file.expand({
						"cwd": upload.cwd,
						"filter": "isFile"
					}, upload.src),
					"dest": upload.dest,
					"cwd": upload.cwd
				};
				return acc;
			},
			{}
		);
		done();
	}

	function preReleaseCheck(done) {
		// TODO: check if we have modified files, we must not release this
		_.each(release.deploy.data, function(upload, target) {
			if (!upload.src.length) {
				grunt.log.writeln("Nothing to upload for target ".yellow + target);
				done(false);
				return;
			}
		});

		var loc = release.deploy.location;
		if (_.isEmpty(release.config.auth[loc])) {
			grunt.fail.fatal("There is no auth info for \"" + loc + "\").");
		}
		if (release.debug) {
			done();
			return;
		}
		var ftp = new FtpUploader({
			"complete": done,
			"auth": release.config.auth[loc],
			"logger": {
				"log": function(text) {
					grunt.log.ok("[" + loc + "]: " + text);
				},
				"error": function(text) {
					grunt.fail.fatal("[" + loc + "]: " + text);
				}
			}
		});
		ftp.ping();
	}

	function deploy(done) {
		/* jshint validthis:true */
		var target = this.args.slice(1).join(":");
		/* jshint validthis:false */
		var upload = release.deploy.data[target];
		grunt.log.writeln(
			(release.debug ? "[simulation] ".cyan : "") +
			"Releasing to " + release.deploy.location.cyan
		);
		var ftp = new FtpUploader({
			"complete": done,
			"auth": release.config.auth[release.deploy.location],
			"uploads": [upload],
			"debug": release.debug,
			"logger": {
				"log": _.bind(grunt.log.writeln, grunt.log),
				"error": _.bind(grunt.log.error, grunt.log)
			}
		});
		ftp.start();
	}

	function purge(done) {
		var config = release.config.purger;
		if (!config || !release.purge || !release.purge.paths.length) {
			grunt.log.writeln("Nothing to purge");
			done();
			return;
		}
		if (release.debug) {
			grunt.log.writeln("Paths to purge: " + release.purge.paths);
		}
		var API = require("limelight-purge-api");
		var api = new API({
			"user": config.user,
			"apiKey": config.apiKey,
			"dryRun": release.debug
		});
		api.createPurge({
			"emailType": "detail",
			"emailSubject": "[Limelight] Code pushed to CDN " +
				"(" + (release.purge.title || "manual purge") + ")",
			"emailTo": config.emailTo,
			"emailCC": config.emailCC || "",
			"entries": release.purge.paths.map(function(path) {
				return {
					"shortname": config.shortname,
					"url": config.url.replace("{path}", path),
					"regex": true
				};
			})
		}).then(function(response) {
			if (release.debug) {
				grunt.log.writeln(
					"The following request data is going to be sent:",
					response
				);
				return Q.reject("No actual purge is performed.");
			}
			if (!response.id) {
				grunt.fail.fatal("Purge request failed");
				return;
			}
			return waitForPurge(response, api);
		}).fail(function(reason) {
			grunt.log.warn(reason);
		}).done(done);
	}

	function postReleaseCheck(done) {
		grunt.log.writeln("Not implemented yet");
		done();
	}

	function waitForPurge(response, api, defer) {
		var inRecursion = !!defer;
		if (!inRecursion) {
			defer = Q.defer();
		}
		Q.delay(5000)
			.then(function() {
				grunt.log.write("Checking status... ");
				return api.getStatusById(response.id, {"includeDetail": true});
			})
			.then(function(status) {
				var estimates = [], statuses = [];
				status.entryStatuses.forEach(function(entry) {
					statuses.push(
						entry.url.yellow + ": " +
						(entry.result || entry.status).cyan
					);
					if (!entry.completed) {
						estimates.push(Date.parse(entry.estimatedCompletedDate));
					}
				});
				if (estimates.length) {
					var ETA =  Math.max.apply(this, estimates);
					ETA = Math.ceil((ETA - Date.now()) / 1000);
					grunt.log.writeln("ETA: " + ETA + " second(s).");
					grunt.log.writeln("\t" + statuses.join("\n\t"));
					// don't wait if it's more than 5 minutes, but should be faster anyway
					if (ETA > 300) {
						defer.reject(
							"Too long to wait. The detailed status will " +
							"be sent to " + response.emailTo +
							(response.emailCC ? " and " + response.emailCC : "") +
							" anyway."
						);
						return;
					}
					waitForPurge(response, api, defer);
				} else {
					grunt.log.writeln("Completed".green);
					grunt.log.writeln("\t" + statuses.join("\n\t"));
					defer.resolve();
				}
			})
			.fail(defer.reject);
		if (!inRecursion) {
			return defer.promise;
		}
	}
};
