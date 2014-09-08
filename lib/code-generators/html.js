var util = require('util');
var _ = require('underscore');

var BaseGenerator = require('./base.js');

function HtmlGenerator(specs, config, templateEngine, fileWriter) {
	BaseGenerator.call(this, specs, config, templateEngine, fileWriter);

	this.name = config.name || 'Test API';
	this.version = config.version || 'V1';

	_.each(['html'], _.bind(function(template) {
		this.templates[template] = this.loadTemplate(template + '.handlebars');
	}, this));

	this.preventDeletion = ['fonts', 'styles', 'css', 'scripts', 'js'];
}

util.inherits(HtmlGenerator, BaseGenerator);

HtmlGenerator.prototype.name = 'html';
HtmlGenerator.prototype.templateDir = 'html';

HtmlGenerator.prototype.decorateOperation = function(operation, resource, name) {
	operation.method = operation.method.toUpperCase();

	operation.body = _.find(operation.parameters, function(parameter) {
		return parameter.in == "body";
	});

	operation.response = operation.responses && operation.responses["200"] ? convertSchema(operation.responses["200"].schema) : null;

	operation.parameters = _.filter(operation.parameters, function(parameter) {
		return parameter.in != "body";
	});
}

HtmlGenerator.prototype.decorateParameter = function(parameter, operation, resource, name) {
	if (parameter.in == "formData") {
		parameter.in = "form";
	}

	convertSchema(parameter);
}

HtmlGenerator.prototype.generate = function() {
	var swagger = this.specs.root;

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

module.exports = HtmlGenerator;