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

function HtmlGenerator(specs, config, templateEngine, fileWriter) {
	BaseGenerator.call(this, specs, config, templateEngine, fileWriter);

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

HtmlGenerator.prototype.generate = function() {
	BaseGenerator.prototype.generate.apply(this, arguments);

	var swagger = this.specs.root;
	
	_.each(this.resources, _.bind(function(resource) {
		_.each(resource.operations, _.bind(function(operation) {
			_.each(operation.parameters, function(parameter) {
				if (parameter.in == "formData") {
					parameter.in = "form";
				}

				convertSchema(parameter);
			});

			operation.method = operation.method.toUpperCase();

			operation.body = _.find(operation.parameters, function(parameter) {
				return parameter.in == "body";
			});

			operation.response = operation.responses && operation.responses["200"] ? convertSchema(operation.responses["200"].schema) : null;

			operation.parameters = _.filter(operation.parameters, function(parameter) {
				return parameter.in != "body";
			});
		}, this));
	}, this));

	var data = {
		info : swagger.info,
		resources : this.resources,
		models : this.models
	}

	this.fileWriter.write(
		'index.html',
		this.templates.html(data)
	);
}

function convertSchema(object) {
	if (object) {
		if (object.schema && object.schema.$ref) {
			object.schema.$ref = convertReference(object.schema.$ref);
		}

		// Needed for response
		if (object.$ref) {
			object.$ref = convertReference(object.$ref);
		}

		if (object.items && object.items.$ref) {
			object.items.$ref = convertReference(object.items.$ref);
		}
	}

	return object;
}

function convertReference($ref) {
	if ($ref) {
		var i = $ref.lastIndexOf('/');

		if (i != -1) {
			$ref = $ref.substring(i + 1);
		}
	}

	return $ref;
}

HtmlGenerator.prototype.generateResources = function(apiDeclaration) {
}

module.exports = HtmlGenerator;