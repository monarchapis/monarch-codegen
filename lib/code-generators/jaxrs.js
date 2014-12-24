var util = require('util');
var _ = require('underscore');
var inflection = require( 'inflection' );

var BaseGenerator = require('./base.js');

var translateTypeMap = {
	'any' : 'Object',
	'integer' : 'Integer',
	'number' : 'BigDecimal',
	'string' : 'String',
	'boolean' : 'Boolean',
	'File' : 'File'
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

var convertMap = {
	'File' : 'InputStream'
};

var paramTypeMap = {
	'formData' : 'form'
};

var importMap = {
	'BigDecimal' : 'java.math.BigDecimal',
	'List' : 'java.util.List',
	'Set' : 'java.util.Set',
	'LocalDate' : 'org.joda.time.LocalDate',
	'DateTime' : 'org.joda.time.DateTime',
	'InputStream' : 'java.io.InputStream'
};

function JaxRSGenerator(specs, config, templateEngine, fileWriter) {
	BaseGenerator.call(this, specs, config, templateEngine, fileWriter);

	// Set package values
	this.package = config.package || 'com.monarchapis.api';
	this.modelPackage = config.modelPackage || (this.package + '.model');
	this.clientPackage = config.clientPackage || (this.package + '.client');
	this.commonPackage = config.commonPackage || (this.package + '.common');
	this.exceptionPackage = config.exceptionPackage || (this.package + '.exception');

	// Set GAV info
	this.groupId = config.groupId || 'com.monarchapis';
	this.artifactId = config.artifactId || 'test-client';
	this.name = config.name || 'Test Client';
	this.version = config.version || '1.0';

	this.homeClass = config.homeClass || 'API';

	_.each(
		['model', 'resource', 'resourceImpl', 'resourceAsync', 'resourceAsyncImpl', 'queryBuilder', 'apiHome', 'apiHomeImpl',
		 'abstractResource', 'requestProcessor', 'objectMapperProvider',
		 'apiError', 'apiErrorException', 'apiException', 'apiValidationError', 'validationError',
		 'pom', 'checkstyle', 'gitignore'],
		_.bind(function(template) {
		this.templates[template] = this.loadTemplate(template + '.handlebars', true);
	}, this));

	this.preventDeletion = ['.settings', '.project', '.classpath'];
}

util.inherits(JaxRSGenerator, BaseGenerator);

JaxRSGenerator.prototype.name = 'jaxrs';
JaxRSGenerator.prototype.templateDir = 'jaxrs';
JaxRSGenerator.prototype.srcDir = 'src/main/java';
JaxRSGenerator.prototype.resourcesDir = 'src/main/resources';

// Enhancements to the data structure prior to template execution
//

JaxRSGenerator.prototype.decorateResource = function(resource, name) {
	return {
		package : this.clientPackage,
		commonPackage : this.commonPackage,
		exceptionPackage : this.exceptionPackage,
		className : name + 'Resource'
	};
}

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

JaxRSGenerator.prototype.decorateParameter = function(parameter, operation, resource, name) {
	var clientMethod = 'set' + this.capitalise(this.translate(parameter.in, paramTypeMap));

	var capped = this.capitalise(parameter.name);
	var isCollection = parameter.type == 'array';

	return {
		type : this.translateType(parameter, resource.imports, true),
		itemType : (parameter.items != null) ? this.translateType(parameter.items, translateTypeMap) : null,
		clientMethod : clientMethod,
		// TODO base on consumes, but prefer JSON
		convertMethod : parameter.in == 'body' ? 'toJson' : null,
		named : parameter.in != 'body',
		// Query builder properties
		property : isCollection ? inflection.pluralize(parameter.name) : parameter.name,
		getter : (parameter.type == 'boolean' ? 'is' : 'get') + (isCollection ? inflection.pluralize(capped) : capped),
		isCollection : isCollection
	};
}

JaxRSGenerator.prototype.decorateModel = function(model) {
	var className = model.name;

	// Customization: Generics type parameters
	//
	if (model['x-typeParameters'] && model['x-typeParameters'].length > 0) {
		className += '<' + model['x-typeParameters'].join(', ') + '>';
	}

	var mapValue = null;

	if (model.additionalProperties == true) {
		mapValue = "Object";
	} else if (model.patternProperties != null) {
		var key = this.first(model.patternProperties);
		var value = model.patternProperties[key];
		mapValue = this.translateType(value, model.imports);
	}

	return {
		package : this.modelPackage,
		className : className,
		mapValue : mapValue
	};
}

JaxRSGenerator.prototype.decorateProperty = function(property, model) {
	var fieldAnnotations = [];
	var getterAnnotations = [];

	var required = _.contains(model.required, property.name);

	if (required) {
		fieldAnnotations.push('@NotNull');
		this.addImport('javax.validation.constraints.NotNull', model.imports);
	}

	var type = this.translateType(property, model.imports);

	if (type == "void") {
		console.log("WARN: could not find model property data type");
	}

	return {
		type : type,
		required : required,
		fieldAnnotations : fieldAnnotations,
		getterAnnotations : getterAnnotations,
		getter : (property.type == 'boolean' ? 'is' : 'get') + this.capitalise(property.name),
		setter : 'set' + this.capitalise(property.name)
	};
}

// Generation of files
//

JaxRSGenerator.prototype.generate = function() {
	this.generateCommonClasses();

	_.each(this.resources, _.bind(function(resource, name) {
		this.generateResource(name, resource);
	}, this));

	_.each(this.queryBuilders, _.bind(function(queryBuilder) {
		this.generateQueryBuilder(queryBuilder);
	}, this));

	_.each(this.models, _.bind(function(model, name) {
		this.generateModel(name, model);
	}, this));


	this.generateHomeClass();
}

JaxRSGenerator.prototype.generateCommonClasses = function() {
	this.fileWriter.write('pom.xml', this.templates.pom({
		groupId : this.groupId,
		artifactId : this.artifactId,
		name : this.name,
		version : this.version
	}));

	this.fileWriter.write('.gitignore', this.templates.gitignore({}));

	this.fileWriter.write(this.resourcesDir, 'checkstyle.xml', this.templates.checkstyle());

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

	var exceptionFiles = [
		['ApiError.java', 'apiError'],
		['ApiErrorException.java', 'apiErrorException'],
		['ApiException.java', 'apiException'],
		['ApiValidationError.java', 'apiValidationError'],
		['ValidationError.java', 'validationError']
	];

	_.each(exceptionFiles, _.bind(function(pair) {
		this.fileWriter.write(
			this.srcDir,
			this.exceptionPackage.split('.').join('/'),
			pair[0],
			this.templates[pair[1]]({
				package : this.exceptionPackage
			})
		);
	}, this));
}

JaxRSGenerator.prototype.generateResource = function(name, resource) {
	console.log('writing resource ' + name);

	this.fileWriter.write(
		this.srcDir,
		resource.package.split('.').join('/'),
		resource.className + '.java',
		this.templates.resource(resource));

	this.fileWriter.write(
		this.srcDir,
		(resource.package + ".impl").split('.').join('/'),
		resource.className + 'Impl.java',
		this.templates.resourceImpl(resource));

	var async = _.clone(resource);

	async.className += 'Async';

	this.fileWriter.write(
		this.srcDir,
		async.package.split('.').join('/'),
		async.className + '.java',
		this.templates.resourceAsync(async));

	this.fileWriter.write(
		this.srcDir,
		(async.package + '.impl').split('.').join('/'),
		async.className + 'Impl.java',
		this.templates.resourceAsyncImpl(async));
}

JaxRSGenerator.prototype.generateQueryBuilder = function(operation) {
	console.log('writing query builder ' + operation.queryBuilder);

	this.fileWriter.write(
		this.srcDir,
		operation.package.split('.').join('/'),
		operation.queryBuilder + '.java',
		this.templates.queryBuilder(operation));
}

JaxRSGenerator.prototype.generateModel = function(name, model) {
	console.log('writing model ' + name);

	this.fileWriter.write(
		this.srcDir,
		model.package.split('.').join('/'),
		model.name + '.java',
		this.templates.model(model));
}

JaxRSGenerator.prototype.generateHomeClass = function() {
	var package = this.clientPackage;

	var resourceClasses = [];
	_.each(this.resources, _.bind(function(resource, name) {
		resourceClasses.push(resource.className);
		resourceClasses.push(resource.className + 'Async');
	}, this));

	this.fileWriter.write(
		this.srcDir,
		package.split('.').join('/'),
		this.homeClass + '.java',
		this.templates.apiHome({
			package : package,
			commonPackage : this.commonPackage,
			exceptionPackage : this.exceptionPackage,
			className : this.homeClass,
			resourceClass : resourceClasses
		})
	);

	this.fileWriter.write(
		this.srcDir,
		(package + '.impl').split('.').join('/'),
		this.homeClass + 'Impl.java',
		this.templates.apiHomeImpl({
			package : package,
			commonPackage : this.commonPackage,
			exceptionPackage : this.exceptionPackage,
			className : this.homeClass,
			resourceClass : resourceClasses
		})
	);
}

// Helpers
//

JaxRSGenerator.prototype.formatResourceName = function(string) {
    return this.capitalise(string);
}

JaxRSGenerator.prototype.formatModelName = function(string) {
    return this.capitalise(string);
}

BaseGenerator.prototype.formatParameterName = function(string) {
	if (string.startsWith("X-")) {
		string = string.substring(2);
	}

	var that = this;

	string = _.map(string.split('-'), function(part) { return that.capitalise(part); }).join('');
	string = this.uncapitalise(string);

    return string;
}

JaxRSGenerator.prototype.translateType = function(property, imports, resource) {
	var type = null;

	if (property.type) {
		if (property.type == 'array') {
			type = property.uniqueItems ? 'Set' : 'List';

			if (property.items) {
				if (property.items.$ref) {
					var itemClass = this.formatModelName(this.getReferenceName(property.items.$ref));
					this.addImport(this.modelPackage + '.' + itemClass, imports);
					type += '<' + itemClass + '>';
				} else {
					type += '<' + this.translateType(property.items) + '>';
				}
			}
		} else {
			type = property.type;

			type = this.translate(property.type, translateTypeMap, type);
			type = this.translate(property.format, translateFormatMap, type);
			type = this.translate(type, convertMap);

			this.addImport(importMap[type], imports);
		}
	// property.$ref needed for response
	} else if (property.$ref || (property.schema && property.schema.$ref)) {
		type = this.formatModelName(this.getReferenceName(property.$ref || property.schema.$ref));

		this.addImport(this.modelPackage + '.' + type, imports);

		// Customization: Generics type arguments
		//
		if (property['x-typeArguments'] && property['x-typeArguments'].length > 0) {
			type += '<' + property['x-typeArguments'].join(', ') + '>';
		}
	} else {
		type = "void";
	}

	if (!type) {
		console.log("WARN: could not translate type");
	}

	return type;
}

module.exports = JaxRSGenerator;