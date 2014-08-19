var _ = require('underscore');
var path = require('path');

function BaseGenerator(templateEngine, fileWriter) {
	this.templateEngine = templateEngine;
	this.fileWriter = fileWriter;
	this.templates = {};
	this.apiDeclarations = [];
	this.uniqueModels = {};
	this.models = [];
	this.preventDeletion = [];
}

BaseGenerator.prototype.setResourceListing = function(resourceListing) {
	this.resourceListing = resourceListing;
}

BaseGenerator.prototype.addApiDeclaration = function(apiDeclaration) {
	this.apiDeclarations.push(apiDeclaration);
	_.extend(this.uniqueModels, apiDeclaration.models);
}

BaseGenerator.prototype.generateResources = function(apiDeclaration) {
	throw "generateResources not implemented";
}

BaseGenerator.prototype.generateHome = function(resourceListing) {
	throw "generateHome not implemented";
}

BaseGenerator.prototype.generate = function() {
	var ids = _.sortBy(_.keys(this.uniqueModels), function(item) { return item.toLowerCase(); });

	this.models = _.map(ids, _.bind(function(id) { return this.uniqueModels[id]; }, this));

	var modelMap = {};

	_.each(ids, _.bind(function(id) {
		modelMap[id] = this.uniqueModels[id];
	}, this));

	this.uniqueModels = modelMap;

	_.each(this.apiDeclarations, _.bind(function(apiDeclaration) {
		var operations = [];

		_.each(apiDeclaration.apis, _.bind(function(api) {
			_.each(api.operations, _.bind(function(operation) {
				operation.path = api.path;
				operations.push(operation);
			}, this));
		}, this));

		var groupedApis = {};

		_.each(apiDeclaration.apis, _.bind(function(api) {
			var title = api.title;

			// Create a default group title
			if (title == null) {
				title = api.path;
				while (title.startsWith('/')) title = title.substring(1);
				title = title.split('/')[0];

				var compressed = api.path.replace(/\//g, '').replace(/\{[\w]+\}/g, '_');

				if (compressed == title + '_') {
					title += ' Collection'
				} else if (compressed.length > title.length) {
					title += ' Actions';
				}

				title = this.capitalise(title);
			}

			var description = api.description;

			var key = title + '|' + (description | '');

			if (title) {
				var group = groupedApis[key];

				if (!group) {
					group = {
						title: title,
						description: description,
						operations: []
					};

					groupedApis[key] = group;
				}

				_.each(api.operations, function(operation) {
					group.operations.push(operation);
				});
			}
		}, this));

		var sortFn = function(operation) {
			return operation.path.replace(/\{[\w]+\}/g, '_').length;
		};

		_.each(groupedApis, function(group) {
			group.operations = _.sortBy(group.operations, sortFn);
		});

		apiDeclaration.groups = groupedApis;

		_.sortBy(operations, sortFn);

		apiDeclaration.operations = operations;
	}, this));

	_.each(this.apiDeclarations, _.bind(function(apiDeclaration) {
		this.generateResources(apiDeclaration);
	}, this));

	this.generateRoot();
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