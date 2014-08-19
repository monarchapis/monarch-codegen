var util = require('util');
var _ = require('underscore');

var BaseGenerator = require('./base.js');

var translateTypeMap = {
	'integer' : 'Integer',
	'number' : 'BigDecimal',
	'string' : 'String',
	'boolean' : 'Boolean'
};

var translateFormatMap = {
	'int32' : 'Integer',
	'int64' : 'Long',
	'float' : 'Float',
	'double' : 'BigDecimal',
	'byte' : 'String',
	'date' : 'LocalDate',
	'date-time' : 'DateTime'
};

var importMap = {
	'BigDecimal' : 'java.math.BigDecimal',
	'List' : 'java.util.List',
	'Set' : 'java.util.Set',
	'LocalDate' : 'org.joda.time.LocalDate',
	'DateTime' : 'org.joda.time.DateTime'
};

function HtmlGenerator(config, templateEngine, fileWriter) {
	BaseGenerator.call(this, templateEngine, fileWriter);

	this.name = config.name || 'Test API';
	this.version = config.version || 'V1';

	_.each(['html'],
		_.bind(function(template) {
			this.templates[template] = this.loadTemplate(template + '.handlebars');
		}, this)
	);

	this.preventDeletion = ['fonts', 'styles', 'css', 'scripts', 'js'];
}

util.inherits(HtmlGenerator, BaseGenerator);

HtmlGenerator.prototype.name = 'html';
HtmlGenerator.prototype.templateDir = 'html';

HtmlGenerator.prototype.recurseSingleUse = function(model, models) {
	_.each(model.properties, _.bind(function(property, name) {
		if (property.$ref) {
			var model = this.uniqueModels[property.$ref];

			if (model && model.singleUse) {
				models.push(model);
				this.recurseSingleUse(model, models);
			}
		}

		if (property.items && property.items.$ref) {
			var model = this.uniqueModels[property.items.$ref];

			if (model && model.singleUse) {
				models.push(model);
				this.recurseSingleUse(model, models);
			}
		}
	}, this));
}

HtmlGenerator.prototype.generateRoot = function() {
	_.each(this.apiDeclarations, _.bind(function(apiDeclaration) {
		_.each(apiDeclaration.operations, _.bind(function(operation) {
			var model = this.uniqueModels[operation.type];

			if (model) {
				model.references = (model.references || 0) + 1;
			}
		}, this));
	}, this));

	_.each(this.uniqueModels, _.bind(function(model) {
		_.each(model.properties, _.bind(function(property, name) {
			if (property.$ref) {
				var model = this.uniqueModels[property.$ref];

				if (model) {
					model.references = (model.references || 0) + 1;
					return false;
				}
			}

			if (property.items && property.items.$ref) {
				var model = this.uniqueModels[property.items.$ref];

				if (model) {
					model.references = (model.references || 0) + 1;
					return false;
				}
			}
		}, this));
	}, this));

	_.each(this.uniqueModels, function(model) {
		model.singleUse = model.references == 1;
		model.multiUse = !model.singleUse;
	});

	_.each(this.apiDeclarations, _.bind(function(apiDeclaration) {
		_.each(apiDeclaration.operations, _.bind(function(operation) {
			var model = this.uniqueModels[operation.type];

			if (model && model.singleUse) {
				var responseModels = [model];

				this.recurseSingleUse(model, responseModels);

				operation.responseModels = responseModels;
			}

			var body = _.find(operation.parameters, function(parameter) {
				return parameter.paramType == "body";
			});

			operation.parameters = _.filter(operation.parameters, function(parameter) {
				return parameter.name != "body";
			});

			if (body) {
				operation.body = body.type;
				var model = this.uniqueModels[body.type];

				if (model) {
					var requestModels = [model];

					this.recurseSingleUse(model, requestModels);

					operation.requestModels = requestModels;
				}
			}
		}, this));
	}, this));

	var commonModels = _.filter(this.uniqueModels, function(model) { return model.multiUse; });

	_.each(this.resourceListing.apis, _.bind(function(api) {
		if (api.description || api.title) {
			var declaration = _.find(this.apiDeclarations, function(declaration) { return declaration.path == api.path; });

			if (declaration) {
				declaration.info = {
					title: api.title,
					description: api.description
				};
			}
		}
	}, this));

	var data = {
		resourceListing : this.resourceListing,
		apiDeclarations : this.apiDeclarations,
		models : this.uniqueModels,
		commonModels : commonModels
	}

	this.fileWriter.write(
		'index.html',
		this.templates.html(data)
	);
}

HtmlGenerator.prototype.generateResources = function(apiDeclaration) {
}

module.exports = HtmlGenerator;