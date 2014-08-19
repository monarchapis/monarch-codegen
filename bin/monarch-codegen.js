#!/usr/bin/env node

// Bypass SSL verification
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

if (typeof String.prototype.startsWith != 'function') {
	String.prototype.startsWith = function (str){
		return this.slice(0, str.length) == str;
	};
}

if (typeof String.prototype.endsWith != 'function') {
	String.prototype.endsWith = function (str){
		return this.slice(-str.length) == str;
	};
}

var _ = require('underscore');
var fs = require('fs');
var path = require('path');
var argv = require('optimist').argv;
var request = require('request');
var $ = require('jquery-deferred');

var FileWriter = require(path.resolve(__dirname, '../lib/file-writer.js'));
var TemplateEngine = require(path.resolve(__dirname, '../lib/template-engine.js'));

if (argv.config) {
	var params = JSON.parse(fs.readFileSync(argv.config, "utf8"));
	argv = _.extend({}, params, argv);
}

if (!argv.generator) {
	console.log("No generator defined");
	process.exit(-1);
}

if (!argv.dest) {
	console.log("No destination path defined");
	process.exit(-1);
}

if (!argv.swaggerUrl) {
	console.log("No swagger URL defined");
	process.exit(-1);
}

var Generator = require(path.resolve(__dirname, '../lib/code-generators/' + argv.generator + '.js'));

var fileWriter = new FileWriter(path.resolve(argv.dest));
var generator = new Generator(argv, TemplateEngine, fileWriter);

fileWriter.clean(generator.preventDeletion);

var specUrl = argv.swaggerUrl;

request(specUrl, function (error, response, body) {
	if (!error && response && response.statusCode == 200) {
		var resourceListing = JSON.parse(body);
		generator.setResourceListing(resourceListing);

		var resourcePaths = _.map(resourceListing.apis, function(api) {
			return api.path;
		});

		var promises = [];
		var apiDeclarations = [];

		_.each(resourcePaths, function(path, i) {
			var promise = $.Deferred();
			promises.push(promise.promise());
			path = path.replace(/\{format\}/, "json")
			var fullPath = specUrl.replace("/resources.json", "") + path

			request(fullPath, function (error, response, body) {
				if (!error && response && response.statusCode == 200) {
					var apiDeclaration = JSON.parse(body);
					apiDeclaration.path = path;
					apiDeclarations[i] = apiDeclaration;
					promise.resolve();
				} else {
					console.log('error getting ' + fullPath + ': ' + response.statusCode);
					promise.reject();
				}
			});
		});

		$.when.apply(null, promises).done(function() {
			_.each(apiDeclarations, function(apiDeclaration) {
				generator.addApiDeclaration(apiDeclaration);
			});
			
			generator.generate();
		}).fail(function() {
			console.log("failed to retrieve one of the api declarations");
			process.exit(-2);
		});
	} else if (response) {
		console.log("error " + response.statusCode);
		process.exit(-2);
	} else {
		console.log("connection refused: " + error);
		process.exit(-2);
	}
});
