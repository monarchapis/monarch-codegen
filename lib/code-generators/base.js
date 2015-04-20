var _ = require('underscore');
var path = require('path');
var fs = require('fs');

function BaseGenerator(specs, config, templateEngine, fileWriter) {
	var proto = this.__proto__;
	this.templateDirs = [];

	while (proto != undefined) {
		this.templateDirs.push(proto.templateDir);
		proto = proto.super_;
	}

	this.templateEngine = templateEngine;
	this.fileWriter = fileWriter;
	this.templates = {};
	this.preventDeletion = [];

	this.specs = specs;
	this.config = config;
}

BaseGenerator.prototype.name = 'base';
BaseGenerator.prototype.templateDir = 'base';

var validMethods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch'];

// Signatures for decorate methods (assigned to the generator prototype)
//
// decorateResource  (resource, name)
// decorateOperation (operation, resource, name)
// decorateParameter (parameter, operation, resource, name)
// decorateResponse  (response, operation, resource, name)
// decorateModel     (model, name)
// decorateProperty  (property, model)

BaseGenerator.prototype.decorate = function(type, object) {
	var fn = this['decorate' + type];

	if (fn) {
		var args = [];
		for (var i=1; i<arguments.length; i++) { args.push(arguments[i]); }
		
		var enhancements = fn.apply(this, args);

		if (enhancements && enhancements != object) {
			_.extend(object, enhancements);
		}
	}
}

BaseGenerator.prototype.processInternalModel = function() {
	var swagger = this.specs.root;

	var modelMap = {};
	var resources = {};
	var queryBuilders = [];

	_.each(swagger.paths, _.bind(function(methods, path) {
		methods = this.resolveReference(methods, swagger).obj;

		var operations = [];

		_.each(methods, _.bind(function(operation, method) {
			// TODO read common parameters
			//

			if (_.contains(validMethods, method)) {
				var clone = _.extend({
					path: path,
					method: method.toUpperCase()
				}, operation);

				clone.parameters = _.map(clone.parameters, _.bind(function(parameter) {
					if (parameter.$ref) {
						parameter = this.resolveReference(parameter, swagger).obj;
					}

					parameter.variable = this.formatParameterName(parameter.name);

					return _.clone(parameter);
				}, this));

				if (_.isArray(this.config.ignoredParameters)) {
					clone.parameters = _.filter(clone.parameters, _.bind(function(parameter) {
						return !_.contains(this.config.ignoredParameters, parameter.name);
					}, this));
				}

				clone.isQueryBuilder =
					clone.method == 'GET' &&
					clone.parameters.length > 2 &&
					_.find(clone.parameters, function(parameter) {
						return parameter.required == true || !_.contains(['query', 'header'], parameter.in);
					}) == null;

				clone.bodyParam      = _.find(clone.parameters, function(parameter) { return parameter.in == 'body'; });
				clone.pathParams     = _.filter(clone.parameters, function(parameter) { return parameter.in == 'path'; });
				clone.queryParams    = _.filter(clone.parameters, function(parameter) { return parameter.in == 'query'; });
				clone.headerParams   = _.filter(clone.parameters, function(parameter) { return parameter.in == 'header'; });
				clone.formParams     = _.filter(clone.parameters, function(parameter) { return parameter.in == 'formData'; });
				clone.requiredParams = _.filter(clone.parameters, function(parameter) { return parameter.required == true; });

				var responses = {};
				_.each(clone.responses, _.bind(function(response, code) {
					responses[code] = _.clone(response);
				}, this));
				clone.responses = responses;

				operations.push(clone);
			}
		}, this));

		// Sort operations by length of path (collapsing path variable names)
		//
		_.sortBy(operations, function(operation) {
			return operation.path.replace(/\{[\w]+\}/g, '_').length;
		});

		// Find references to models
		//
		_.each(operations, _.bind(function(operation) {
			_.each(operation.parameters, _.bind(function(parameter) {
				this.findModels(parameter, swagger, modelMap);
			}, this));

			_.each(operation.responses, _.bind(function(response) {
				this.findModels(response, swagger, modelMap);
			}, this));
		}, this));

		// Put the operations into groupss
		//
		_.each(operations, _.bind(function(operation) {
			var resourceName = (operation.tags && operation.tags.length > 0) ? this.formatResourceName(operation.tags[0]) : null;
			var groupName = operation.path;

			while (groupName.startsWith('/')) groupName = groupName.substring(1);
			groupName = groupName.split('/')[0];

			if (resourceName == null) {
				resourceName = this.capitalise(groupName);
			}

			var compressed = operation.path.replace(/\//g, '').replace(/\{[\w]+\}/g, '_');

			if (compressed != groupName + '_') {
				if (compressed == groupName) {
					groupName += ' Collection';
				} else if (compressed.length > groupName.length) {
					groupName += ' Actions';
				}
			}

			groupName = this.capitalise(groupName);

			////////////////////

			var resource = resources[resourceName];
			var resourceDefinition = _.find(swagger['x-resources'], function(resource) {
				return path.startsWith(resource.path);
			}) || {};

			if (!resource) {
				resource = {
					imports : [],
					asyncImports : [],
					description : resourceDefinition.description || "Operations for " + resourceName,
					operations : [],
					groups : {},
					produces : swagger.produces,
					consumes : swagger.consumes
				};

				resources[resourceName] = resource;
			}

			var group = resource.groups[groupName];

			if (!group) {
				group = {
					description : "",
					operations : []
				};

				resource.groups[groupName] = group;
			}

			if (operation.isQueryBuilder) {
				operation.queryBuilder = this.capitalise(resourceName) + 'Query';
				queryBuilders.push(operation);
			}

			resource.operations.push(operation);
			group.operations.push(operation);
		}, this));
	}, this));

	// Enhance resources/operations/parameters/responses with helper data for templates
	//
	_.each(resources, _.bind(function(resource, name) {
		this.decorate('Resource', resource, name);

		_.each(resource.operations, _.bind(function(operation) {
			this.decorate('Operation', operation, resource, name);

			_.each(operation.parameters, _.bind(function(parameter) {
				this.decorate('Parameter', parameter, operation, resource, name);
			}, this));

			_.each(operation.responses, _.bind(function(response) {
				this.decorate('Response', response, operation, resource, name);
			}, this));
		}, this));

		resource.imports.sort();
		resource.asyncImports.sort();
		resource.methods = resource.operations;
	}, this));

	// Enhance models/properties with helper data for templates
	//
	_.each(modelMap, _.bind(function(model, name) {
		model = _.clone(model);
		modelMap[name] = model;
		model.name = name;
		model.imports = [];
		this.decorate('Model', model);

		// Pull in model properties from "allOf" compositions
		if (model.allOf) {
			model.properties = model.properties || {};
			var props = {};

			_.each(model.allOf, _.bind(function(other) {
				if (other.$ref) {
					other = this.resolveReference(other, swagger).obj;
				}

				_.extend(model.properties, other.properties);

				if (other.required) {
					model.required = model.required || [];
					model.required.push.apply(model.required, other.required);
				}
			}, this));
		}

		_.each(model.properties, _.bind(function(property, name) {
			property = _.clone(property);
			model.properties[name] = property;
			property.name = name;
			if (property != null) {
				this.decorate('Property', property, model);
			}
		}, this));
	}, this));

	// Sort the models by key
	//
	var ids = _.sortBy(_.keys(modelMap), function(item) { return item.toLowerCase(); });
	this.models = {};

	_.each(ids, _.bind(function(id) {
		this.models[id] = modelMap[id];
	}, this));

	// Sort resource groups by [Collection, Entity, Actions]
	//
	_.each(resources, _.bind(function(resource) {
		var keys = _.keys(resource.groups);
		keys = _.sortBy(keys, function(group) {
			if (group.endsWith(" Collection")) {
				return 1;
			} else if (group.endsWith(" Actions")) {
				return 3;
			} else {
				return 2;
			}
		});

		var sorted = {};

		_.each(keys, function(key) {
			sorted[key] = resource.groups[key];
		});

		resource.groups = sorted;
	}, this));

	// Sort the resources for name
	//
	var keys = _.sortBy(_.keys(resources), function(item) { return item.toLowerCase(); });
	var sorted = {};

	_.each(keys, function(key) {
		sorted[key] = resources[key];
	});

	this.resources = sorted;
	this.queryBuilders = queryBuilders;
}

BaseGenerator.prototype.generate = function() {
	console.log("generate is not implemented");
}

BaseGenerator.prototype.formatResourceName = function(string) {
    return string;
}

BaseGenerator.prototype.formatModelName = function(string) {
    return string;
}

BaseGenerator.prototype.formatPropertyName = function(string) {
    return string;
}

BaseGenerator.prototype.formatParameterName = function(string) {
    return string;
}

BaseGenerator.prototype.capitalise = function(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

BaseGenerator.prototype.uncapitalise = function(string) {
    return string.charAt(0).toLowerCase() + string.slice(1);
}

BaseGenerator.prototype.loadTemplate = function(filename, noEscape) {
	var templateSource;

	for (var i=0; i<this.templateDirs.length; i++) {
		var templateDir = this.templateDirs[i];
		var pathToCheck = path.resolve(__dirname, '../../templates/', templateDir, filename);

		if (fs.existsSync(pathToCheck)) {
			templateSource = pathToCheck;
			break;
		}
	}

	if (!templateSource) {
		throw "Could not find template " + filename;
	}

	return this.templateEngine.compile(templateSource, noEscape);
}

BaseGenerator.prototype.getMimeType = function(array) {
	if (!array || array.length == 0) {
		return null;
	}

	if (_.contains(array, 'application/json')) {
		return 'application/json';
	}

	return array[0];
}

BaseGenerator.prototype.translate = function(value, lookup, defaultValue) {
	return lookup[value] || defaultValue  || value;
}

BaseGenerator.prototype.findRef = function(obj) {
	if (obj.type && obj.type == 'array' && obj.items && obj.items.$ref) {
		obj = obj.items;
	}

	if (obj.schema && obj.schema.$ref) {
		obj = obj.schema;
	}

	return obj;
}

BaseGenerator.prototype.findModels = function(obj, root, modelMap) {
	obj = this.findRef(obj);

	if (obj.$ref) {
		var id = this.formatModelName(this.getReferenceName(obj.$ref));
		var ref = this.resolveReference(obj, root);
		var model = ref.obj;

		if (model) {
			if (modelMap[id] == null) {
				model = _.clone(model);
				modelMap[id] = model;
				this.scanModel(model, root, ref.parent, modelMap);
			}
		} else {
			console.log(id);
			console.log("WARN: model was null");
		}
	}
}

BaseGenerator.prototype.first = function(obj) {
    for (var a in obj) return a;
}

BaseGenerator.prototype.scanModel = function(model, root, parent, modelMap) {
	_.each(model.properties, _.bind(function(property, name) {
		property = this.findRef(property);

		this.addModel(property, model, root, parent, modelMap);
	}, this));

	if (model.patternProperties != null) {
		var key = this.first(model.patternProperties);
		var property = model.patternProperties[key];
		
		this.addModel(property, model, root, parent, modelMap);
	}
}

BaseGenerator.prototype.addModel = function(property, model, root, parent, modelMap) {
	if (property.$ref) {
		var id = this.formatModelName(this.getReferenceName(property.$ref));
		var ref = this.resolveReference(property, root, parent);
		var model = ref.obj;

		if (model) {
			if (modelMap[id] == null) {
				model = _.clone(model);
				modelMap[id] = model;
				this.scanModel(model, root, ref.parent, modelMap);
			}
		} else {
			console.log("WARN: model was null");
		}
	}
}

BaseGenerator.prototype.getReferenceName = function($ref) {
	if ($ref) {
		var i = $ref.lastIndexOf('/');

		if (i != -1) {
			$ref = $ref.substring(i + 1);
		}
	}

	return $ref;
}

BaseGenerator.prototype.resolveReference = function(obj, root, parent) {
	if (!obj.$ref) {
		return { obj : obj, parent : parent };
	}

	var parts = obj.$ref.split('#');
	var href = parts[0];
	var path = parts.length > 1 ? parts[1] : null;

	if (path) {
		while (path.startsWith('/')) path = path.substring(1);
		path = path.split('/');
	}

	var data = obj;

	if (href.startsWith('http:') || href.startsWith('https:')) {
		root = this.specs[href];
	}

	if (path) {
		data = root;
		var parent = null;

		_.each(path, function(slug) {
			if (data != null) {
				parent = data;
				data = data[slug];
			}
		});

		return { obj : data, parent : parent };
	} else if (parent) {
		data = parent[obj.$ref] || data;

		return { obj : data, parent : parent };
	} else {
		return { obj : data, parent : parent };
	}
}

BaseGenerator.prototype.addImport = function(className, imports) {
	imports = imports || this.imports;

	if (className && !_.contains(imports, className)) {
		imports.push(className);
	}
}

module.exports = BaseGenerator;