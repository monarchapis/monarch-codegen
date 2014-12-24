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

var FileWriter = require(path.resolve(__dirname, '../lib/file-writer.js'));
var TemplateEngine = require(path.resolve(__dirname, '../lib/template-engine.js'));
var loader = require('../lib/loader.js');

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

var Generator = require('../lib/code-generators/' + argv.generator + '.js');

// Construct file writer relative to CWD if no absolute path is provided
var fileWriter = new FileWriter(path.resolve(argv.dest));

loader(argv.swaggerUrl, function(specs, error) {
	if (!error && specs) {
		if (argv.debug) {
			console.log(JSON.stringify(specs, undefined, 2));
		}

		var generator = new Generator(specs, argv, TemplateEngine, fileWriter);

		// Clean out any previously generated files
		fileWriter.clean(generator.preventDeletion);

		generator.processInternalModel();
		generator.generate();
	} else if (error) {
		console.log(error);
		process.exit(-2);
	}
});