var _ = require('underscore');
var path = require('path');

function BaseGenerator(specs, config, templateEngine, fileWriter) {
	this.templateEngine = templateEngine;
	this.fileWriter = fileWriter;
	this.templates = {};
	this.preventDeletion = [];

	this.specs = specs;
}

var validMethods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch'];

BaseGenerator.prototype.generate = function() {
	var swagger = this.specs.root;

	var modelMap = {};
	var resources = {};

	_.each(swagger.paths, _.bind(function(methods, path) {
		methods = this.resolveReference(methods, swagger).obj;

		var operations = [];

		_.each(methods, function(operation, method) {
			// TODO read common parameters
			//

			if (_.contains(validMethods, method)) {
				var clone = _.extend({
					path: path,
					method: method
				}, operation);

				operations.push(clone);
			}
		});

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
			var resourceName = (operation.tags && operation.tags.length > 0) ? operation.tags[0] : null;
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
					description : resourceDefinition.description || "Operations for " + resourceName,
					operations : [],
					groups : {}
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

			resource.operations.push(operation);
			group.operations.push(operation);
		}, this));
	}, this));

	// Sort the models by key
	//
	var ids = _.sortBy(_.keys(modelMap), function(item) { return item.toLowerCase(); });
	this.models = {};

	_.each(ids, _.bind(function(id) {
		this.models[id] = swagger.definitions[id];
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
}

BaseGenerator.prototype.capitalise = function(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

BaseGenerator.prototype.loadTemplate = function(filename) {
	return this.templateEngine.compile(path.resolve(__dirname, '../../templates/', this.templateDir, filename));
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
		var id = this.getReferenceName(obj.$ref);
		var ref = this.resolveReference(obj, root);
		var model = ref.obj;

		if (model) {
			modelMap[id] = model;
			this.scanModel(model, root, ref.parent, modelMap);
		} else {
			console.log("WARN: model was null");
		}
	}
}

BaseGenerator.prototype.scanModel = function(model, root, parent, modelMap) {
	_.each(model.properties, _.bind(function(property, name) {
		property = this.findRef(property);

		if (property.$ref) {
			var id = this.getReferenceName(property.$ref);
			var ref = this.resolveReference(property, root, parent);
			var model = ref.obj;

			if (model) {
				modelMap[id] = model;
				this.scanModel(model, root, ref.parent, modelMap);
			} else {
				console.log("WARN: model was null");
			}
		}
	}, this));
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

module.exports = BaseGenerator;