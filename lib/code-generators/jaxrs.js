var util = require('util');
var _ = require('underscore');

var JavaGenerator = require('./java.js');

function JaxRSGenerator(specs, config, templateEngine, fileWriter) {
	JavaGenerator.call(this, specs, config, templateEngine, fileWriter);

	_.each(
		['apiHomeImpl',
		 'abstractResource', 'requestProcessor', 'objectMapperProvider'],
		_.bind(function(template) {
		this.templates[template] = this.loadTemplate(template + '.handlebars', true);
	}, this));
}

util.inherits(JaxRSGenerator, JavaGenerator);
JaxRSGenerator.prototype.super_ = JavaGenerator.prototype;

JaxRSGenerator.prototype.name = 'jaxrs';
JaxRSGenerator.prototype.templateDir = 'jaxrs';

// Enhancements to the data structure prior to template execution
//

JaxRSGenerator.prototype.decorateOperation = function(operation, resource, name) {
	var response = null;

	if (operation.responses) {
		response = operation.responses["200"] || operation.responses["201"];
	}

	var okResponse = response != null ? response.schema || {} : {};
	var returnType = this.translateType(okResponse, resource.imports, true);
	var parseAs = "";

	var path = operation.path.replace(/(\{[^\}]*\})/g, '_|_$1_|_')
	var pathParts = _.filter(path.split('_|_'), function(part) { return part != ''; });
	pathParts = _.map(pathParts, function(part) {
		if (part.startsWith('{') && part.endsWith('}')) {
			return 'String.valueOf(' + part.substring(1, part.length - 1) + ')';
		} else {
			return '"' + part.replace(/"/g, '\\"') + '"';
		}
	});

	if (returnType.indexOf('<') == -1) {
		parseAs = returnType + '.class';
	} else {
		parseAs = 'new GenericType<' + returnType + '>() {}';
	}

	var operationName = operation['x-resource-operation'] || operation.operationId;

	return {
		package : this.clientPackage,
		pathParts : pathParts,
		methodLc : operation.method.toLowerCase(),
		accepts : this.getMimeType(operation.produces) || this.getMimeType(resource.produces) || 'application/json',
		contentType : _.contains(['GET', 'DELETE'], operation.method)
			? null
			: (this.getMimeType(operation.consumes) || this.getMimeType(resource.consumes) || 'application/json'),
		returnType : returnType,
		hasReturn : returnType != "void",
		parseAs : parseAs,
		operation : operationName
	};
}

JaxRSGenerator.prototype.generateCommonClasses = function() {
	JavaGenerator.prototype.generateCommonClasses.apply(this, arguments);

	var commonFiles = [
		['AbstractResource.java', 'abstractResource'],
		['RequestProcessor.java', 'requestProcessor'],
		['ObjectMapperProvider.java', 'objectMapperProvider']
	];

	_.each(commonFiles, _.bind(function(pair) {
		this.fileWriter.write(
			this.srcDir,
			this.commonPackage.split('.').join('/'),
			pair[0],
			this.templates[pair[1]]({
				package : this.commonPackage,
				exceptionPackage : this.exceptionPackage
			})
		);
	}, this));
}

module.exports = JaxRSGenerator;