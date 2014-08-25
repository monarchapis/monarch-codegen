var _ = require('underscore');
var path = require('path');

function BaseGenerator(templateEngine, fileWriter) {
	this.templateEngine = templateEngine;
	this.fileWriter = fileWriter;
	this.templates = {};
	this.preventDeletion = [];
}

BaseGenerator.prototype.generate = function(swagger) {
	this.swagger = swagger;

	var ids = _.sortBy(_.keys(swagger.definitions), function(item) { return item.toLowerCase(); });

	var modelMap = {};

	_.each(ids, _.bind(function(id) {
		modelMap[id] = swagger.definitions[id];
	}, this));

	this.models = modelMap;

	var resources = {};

	_.each(swagger.paths, _.bind(function(methods, path) {
		var operations = [];

		_.each(methods, function(operation, method) {
			var clone = _.extend({
				path: path,
				method: method
			}, operation);

			operations.push(clone);
		});

		_.sortBy(operations, function(operation) {
			return operation.path.replace(/\{[\w]+\}/g, '_').length;
		});

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

	var keys = _.keys(resources).sort();
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

module.exports = BaseGenerator;