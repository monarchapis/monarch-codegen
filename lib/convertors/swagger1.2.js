var _ = require('underscore');
var $ = require('jquery-deferred');
var md = require('html-md');
var url = require('url');
var request = require('request');

function assign(target, targetProperty, source, sourceProperty, defaultValue) {
	if (source && source[sourceProperty]) {
		target[targetProperty] = source[sourceProperty] || defaultValue;
	} else if (defaultValue) {
		target[targetProperty] = defaultValue;
	}
}

var primitiveTypes = ['integer', 'number', 'string', 'boolean', 'File'];


module.exports.sourceVersion = "Swagger 1.2";

module.exports.applies = function(data) {
	return (data.swaggerVersion && data.swaggerVersion == "1.2");
}

module.exports.convert = function(specUrl, resourceListing, callback) {
	var v2 = {
		swagger : 2.0
	};

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

	var resourcePaths = _.map(resourceListing.apis, function(api) {
		return api.path;
	});

	var promises = [];

	var definitions = {};

	_.each(resourcePaths, function(path, i) {
		var promise = $.Deferred();
		promises.push(promise.promise());
		path = path.replace(/\{format\}/, "json");
		var fullPath = specUrl.replace("/resources.json", "") + path;

		request(fullPath, function (error, response, body) {
			if (!error && response && response.statusCode == 200) {
				var apiDeclaration = JSON.parse(body);

				if (v2.info.version == null) {
					v2.info.version = apiDeclaration.apiVersion;
				}

				if (v2.host == "unknown" || v2.basePath == "unknown") {
					var base = url.parse(apiDeclaration.basePath);
					v2.host = base.host;
					v2.basePath = base.pathname;
				}

				var resourceProduces = apiDeclaration.produces;
				var resourceConsumes = apiDeclaration.consumes;

				// What to do with authorizations -> security?
				// Assuming security is an array of permissions/oauth scopes
				//
				// Pull apiDeclaration level security down to operations
				//
				var resourceSecurity = null;

				if (apiDeclaration.authorizations &&
					apiDeclaration.authorizations.oauth &&
					apiDeclaration.authorizations.oauth.scopes) {
					resourceSecurity = _.map(apiDeclaration.authorizations.oauth.scopes, function(scope) {
						return scope.scope;
					});
				}

				_.each(apiDeclaration.apis, function(api) {
					var path = v2.paths[api.path] = {};

					_.each(api.operations, function(operation) {
						var method = {};

						assign(method, 'summary', operation, 'summary');
						assign(method, 'description', operation, 'notes');
						assign(method, 'operationId', operation, 'nickname');

						if (resourceProduces) {
							method.produces = resourceProduces;
						}

						assign(method, 'produces', operation, 'produces');

						if (resourceConsumes) {
							method.consumes = resourceConsumes;
						}

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
								assign(mapped, 'uniqueItems', parameter, 'uniqueItems');

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
									target.type = "array";
									target.items = props;
								} else {
									_.extend(target, props);
								}

								// Files hasn't made it over yet.
								//
								if (target.type == 'File') {
									target.type = 'string';
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

						if (resourceSecurity) {
							method.security = resourceSecurity;
						}

						// TODO schemes

						// What to do with authorizations -> security?
						// Assuming security is an array of permissions/oauth scopes
						//
						if (operation.authorizations &&
							operation.authorizations.oauth &&
							operation.authorizations.oauth.scopes) {
							method.security = _.map(operation.authorizations.oauth.scopes, function(scope) {
								return scope.scope;
							});
						}

						path[operation.method.toLowerCase()] = method;
					});
				})

				_.each(apiDeclaration.models, function(model, name) {
					var definition = {};

					if (model.required) {
						definition.required = model.required;
					}

					definition.properties = {};
					_.each(model.properties, function(property, name) {
						var prop = _.clone(property);

						prop.required = _.contains(model.required, name);
						assign(prop, 'type', property, 'type');
						assign(prop, 'schema', property, 'schema');
						assign(prop, 'items', property, 'items');

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

				promise.resolve();
			} else {
				console.log('error getting ' + fullPath + ': ' + response.statusCode);
				promise.reject();
			}
		});
	});

	$.when.apply(null, promises).done(function() {
		if (!_.isEmpty(definitions)) {
			v2.definitions = definitions;
		}

		callback(v2);
	}).fail(function() {
		callback(null, "failed to retrieve one of the api declarations");
	});
}