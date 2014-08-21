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
var url = require('url');
var md = require('html-md');
var jsyaml = require('js-yaml');
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

// <v2>
function assign(target, targetProperty, source, sourceProperty, defaultValue) {
	if (source && source[sourceProperty]) {
		target[targetProperty] = source[sourceProperty] || defaultValue;
	} else if (defaultValue) {
		target[targetProperty] = defaultValue;
	}
}

var yamlMimes = ['text/yaml', 'text/x-yaml', 'application/yaml', 'application/x-yaml'];

var primitiveTypes = ['integer', 'number', 'string', 'boolean', 'File'];

var v2 = {
	swagger : 2.0
};
// </v2>

request(specUrl, function (error, response, body) {
	if (!error && response && response.statusCode == 200) {
		var contentType = response.headers['content-type'];
		if (contentType) contentType = contentType.split(';')[0];
		var resourceListing = _.contains(yamlMimes, contentType) ? jsyaml.load(body) : JSON.parse(body);

		// <v2>
		if (resourceListing.info) {
			v2.info = {};
			v2.info.title = resourceListing.info.title;
			v2.info.version = resourceListing.apiVersion;
			v2.info.description = md(resourceListing.info.description);
			// TODO terms of service

			if (resourceListing.info.contact) {
				v2.info.contact = { name : resourceListing.info.contact }
			}

			if (resourceListing.info.license) {
				v2.info.license = v2.info.license || {};
				v2.info.license.name = resourceListing.info.license;
			}

			if (resourceListing.info.licenseUrl) {
				v2.info.license = v2.info.license || {};
				v2.info.license.url = resourceListing.info.licenseUrl;
			}

			// TODO authorizations?
		}

		v2.host = "unknown";
		v2.basePath = "unknown";

		v2['x-resources'] = resourceListing.apis;
		v2.paths = {};
		// </v2>

		generator.setResourceListing(resourceListing);

		var resourcePaths = _.map(resourceListing.apis, function(api) {
			return api.path;
		});

		var promises = [];
		var apiDeclarations = [];

		_.each(resourcePaths, function(path, i) {
			var promise = $.Deferred();
			promises.push(promise.promise());
			path = path.replace(/\{format\}/, "json");
			var fullPath = specUrl.replace("/resources.json", "") + path;

			request(fullPath, function (error, response, body) {
				if (!error && response && response.statusCode == 200) {
					var contentType = response.headers['content-type'];
					if (contentType) contentType = contentType.split(';')[0];
					var apiDeclaration = _.contains(yamlMimes, contentType) ? jsyaml.load(body) : JSON.parse(body);

					if (v2.info.version == null) {
						v2.info.version = apiDeclaration.apiVersion;
					}

					// <v2>
					if (v2.host == "unknown" || v2.basePath == "unknown") {
						var base = url.parse(apiDeclaration.basePath);
						v2.host = base.host;
						v2.basePath = base.pathname;
					}

					_.each(apiDeclaration.apis, function(api) {
						var path = v2.paths[api.path] = {};

						_.each(api.operations, function(operation) {
							var method = {};

							assign(method, 'summary', operation, 'summary');
							assign(method, 'description', operation, 'notes');
							assign(method, 'operationId', operation, 'nickname');
							assign(method, 'produces', operation, 'produces');
							assign(method, 'consumes', operation, 'consumes');

							if (operation.parameters && operation.parameters.length > 0) {
								method.parameters = _.map(operation.parameters, function(parameter) {
									var mapped = {
										name : parameter.name,
										in : parameter.paramType == 'form' ? 'formData' : parameter.paramType,
									}

									if (parameter.description) {
										mapped.description = md(parameter.description);
									}

									mapped.required = parameter.paramType == 'body' ? true : parameter.required;

									// uniqueItems was removed
									// 

									var target = mapped;
									var props = {};

									if (parameter.paramType == 'body' && parameter.type == "array") {
										// This would not validate through the schema.
										//
										//props.type = "array";
										//props.items = {
										props.schema = {
											'$ref' : "#/definitions/" + parameter.items['$ref']
										}
									} else if (_.contains(primitiveTypes, parameter.type)) {
										props.type = parameter.type;

										if (parameter.format) {
											props.format = parameter.format;
										}
									} else {
										props.schema = {
											'$ref' : "#/definitions/" + parameter.type
										}
									}

									if (parameter.allowMultiple) {
										target.type == "array";
										target.items = props;
									} else {
										_.extend(target, props);
									}

									// Files hasn't made it over yet.
									//
									if (target.type == 'File') {
										target.type = 'string';
									}

									// What to do with authorizations -> security?
									// Assuming security is an array of permissions/oauth scopes
									//
									if (operation.authorizations &&
										operation.authorizations.oauth &&
										operation.authorizations.oauth.scopes) {
										mapped.security = _.map(operation.authorizations.oauth.scopes, function(scope) {
											return scope.scope;
										});
									}

									return mapped;
								});
							}

							var responses = {};

							if (operation.type && operation.type != "void") {
								var items = {};
								var response = {
									description : "Success",
									schema : {}
								}

								if (operation.type == "array") {
									response.schema.type = "array";
									response.schema.items = {
										'$ref' : "#/definitions/" + operation.items['$ref']
									}
								} else  if (_.contains(primitiveTypes, operation.type)) {
									response.schema.type = operation.type;

									if (operation.format) {
										response.schema.format = operation.format;
									}
								} else {
									response.schema['$ref'] = "#/definitions/" + operation.type;
								}

								responses["200"] = response;
							}

							if (operation.responseMessages) {
								_.each(operation.responseMessages, function(response) {
									responses[response.code] = {
										description : response.message
									};
								});
							}

							if (_.isEmpty(responses)) {
								responses["200"] = { description : "Success" };
							}

							method.responses = responses;

							path[operation.method.toLowerCase()] = method;
						});
					})

					var definitions = v2.definitions = {};

					_.each(apiDeclaration.models, function(model, name) {
						var definition = {};

						if (model.required) {
							definition.required = model.required;
						}

						definition.properties = {};
						_.each(model.properties, function(property, name) {
							var prop = _.clone(property);

							if (prop.type == "integer") {
								if (prop.minimum) prop.minimum = parseInt(prop.minimum);
								if (prop.maximum) prop.maximum = parseInt(prop.maximum);
							} else if (prop.type == "number") {
								if (prop.minimum) prop.minimum = parseFloat(prop.minimum);
								if (prop.maximum) prop.maximum = parseFloat(prop.maximum);
							}


							definition.properties[name] = prop;
						});

						definitions[name] = definition;
					});
					// </v2>

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
			// <v2>
			console.log(JSON.stringify(v2, undefined, 2));
			// </v2>

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
