module.exports = function(grunt) {
	"use strict";

	var FtpUploader = require("ftp-uploader");
	var http = require("http");
	var _ = require("lodash");

	var release = {};

	grunt.registerMultiTask("release", "Release", function() {
		// don't let release everything at once
		_.map(grunt.cli.tasks, function(name) {
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
			grunt.fail.fatal("Release can be performed only in the \"production\" and \"staging\" environment.");
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
		var tasks = ["release-steps:build", "release-steps:prepare", "release-steps:check:before"];
		if (options.skipBuild) {
			tasks.shift();
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
			grunt.fail.fatal("Release steps can't be executed separately but only as a part of whole release process.");
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
		release.deploy.data = {};
		_.each(release.deploy.targets, function(uploads, target) {
			release.deploy.data[target] = _(uploads).chain().map(function(upload) {
				return {
					"src": grunt.file.expand({
						"cwd": upload.cwd,
						"filter": "isFile"
					}, upload.src),
					"dest": upload.dest,
					"cwd": upload.cwd
				};
			}).flatten().value();
		});
		done();
	}

	function preReleaseCheck(done) {
		// TODO: check if we have modified files, we must not release this
		_.each(release.deploy.data, function(uploads, target) {
			if (!uploads || !uploads.length) {
				grunt.log.writeln("Nothing to upload for target ".yellow + target);
				done(false);
				return;
			}
			_.each(uploads, function(upload) {
				if (!upload.src.length) {
					grunt.log.writeln("Empty source list for target ".yellow + target);
					done(false);
					return;
				}
			});
		});

		var loc = release.deploy.location;
		if (_.isEmpty(release.config.auth[loc])) {
			grunt.fail.fatal("There is no auth info for \"" + loc + "\").");
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
		var uploads = release.deploy.data[target];
		grunt.log.writeln((release.debug ? "[simulation] ".cyan : "") + "Releasing to " + release.deploy.location.cyan);
		var ftp = new FtpUploader({
			"complete": done,
			"auth": release.config.auth[release.deploy.location],
			"uploads": uploads,
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
		var xml =
			'<?xml version="1.0" encoding="utf-8"?>' +
			'<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
				'<soap:Header>' +
					'<AuthHeader xmlns="http://www.llnw.com/Purge">' +
						'<Username>' + config.user + '</Username>' +
						'<Password>' + config.password + '</Password>' +
					'</AuthHeader>' +
				'</soap:Header>' +
				'<soap:Body>' +
					'<CreatePurgeRequest xmlns="http://www.llnw.com/Purge">' +
					'<request>' +
						'<EmailType>detail</EmailType>' +
						'<EmailSubject>[Limelight] Code pushed to CDN (' + (release.purge.title || "manual purge") + ')</EmailSubject>' +
						'<EmailTo>' + config.emailTo + '</EmailTo>' +
						'<EmailCc>' + (config.emailCC || "") + '</EmailCc>' +
						'<EmailBcc></EmailBcc>' +
						'<Entries>' +
							release.purge.paths.map(function(path) {
								return '<PurgeRequestEntry>' +
									'<Shortname>' + config.target.name + '</Shortname>' +
									'<Url>' + config.target.url.replace("{path}", path) + '</Url>' +
									'<Regex>true</Regex>' +
								'</PurgeRequestEntry>';
							}).join("") +
						'</Entries>' +
					'</request>' +
					'</CreatePurgeRequest>' +
				'</soap:Body>' +
			'</soap:Envelope>';
		if (release.debug) {
			console.log("Paths to purge: " + release.purge.paths);
			console.log(xml);
			done();
			return;
		}
		var req = http.request({
			"host": config.host,
			"path": config.path,
			"method": "POST",
			"headers": {
				"Content-Type": "text/xml"
			}
		}, function(response) {
			if (response.statusCode === 200) {
				grunt.log.ok();
				done();
			} else if (response.statusCode === 500) {
				response.on("data", function (text) {
					grunt.log.writeln(text);
					grunt.fail.fatal("Can't purge");
				});
			} else {
				grunt.fail.fatal("Can't purge: " + response.statusCode + " error");
			}
		});
		req.on("error", function(e) {
			grunt.fail.fatal("Problem with request: " + e.message);
		});
		req.write(xml);
		req.end();
	}

	function postReleaseCheck(done) {
		grunt.log.writeln("Not implemented yet");
		done();
	}
};
