var util = require('util');
var _ = require('underscore');
var inflection = require('inflection');

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

function JavaGenerator(specs, config, templateEngine, fileWriter) {
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
		['model', 'resource', 'resourceAsync', 'queryBuilder', 'apiHome',
		 'apiError', 'apiErrorException', 'apiException', 'apiValidationError', 'validationError',
		 'pom', 'checkstyle', 'gitignore'],
		_.bind(function(template) {
		this.templates[template] = this.loadTemplate(template + '.handlebars', true);
	}, this));

	this.preventDeletion = ['.settings', '.project', '.classpath'];
}

util.inherits(JavaGenerator, BaseGenerator);
JavaGenerator.prototype.super_ = BaseGenerator.prototype;

JavaGenerator.prototype.name = 'java';
JavaGenerator.prototype.templateDir = 'java';

JavaGenerator.prototype.srcDir = 'src/main/java';
JavaGenerator.prototype.resourcesDir = 'src/main/resources';

// Enhancements to the data structure prior to template execution
//

JavaGenerator.prototype.decorateResource = function(resource, name) {
	return {
		package : this.clientPackage,
		commonPackage : this.commonPackage,
		exceptionPackage : this.exceptionPackage,
		className : name + 'Resource'
	};
}

JavaGenerator.prototype.decorateOperation = function(operation, resource, name) {
	var okResponse = operation.responses && operation.responses["200"] ? operation.responses["200"].schema || {} : {};
	var returnType = this.translateType(okResponse, resource.imports, true);
	var parseAs = "";

	if (returnType.indexOf('<') == -1) {
		parseAs = returnType + '.class';
	} else {
		parseAs = 'new TypeReference<' + returnType + '>() {}';
	}

	return {
		accepts : this.getMimeType(operation.produces),
		contentType : _.contains(['GET', 'DELETE'], operation.method) ? null : this.getMimeType(operation.consumes),
		returnType : returnType,
		hasReturn : returnType != "void",
		parseAs : parseAs,
		operation : operation.operationId
	};
}

JavaGenerator.prototype.decorateParameter = function(parameter, operation, resource, name) {
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

JavaGenerator.prototype.decorateModel = function(model) {
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

JavaGenerator.prototype.decorateProperty = function(property, model) {
	var fieldAnnotations = [];
	var getterAnnotations = [];

	var required = _.contains(model.required, property.name);

	var type = this.translateType(property, model.imports);

	if (type == "void") {
		console.log("WARN: could not find model property data type");
	}

	if (required) {
		fieldAnnotations.push('@NotNull');
		this.addImport('javax.validation.constraints.NotNull', model.imports);
	} else {
		this.addImport('com.google.common.base.Optional', model.imports);
		type = 'Optional<' + type + '>';
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

JavaGenerator.prototype.generate = function() {
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

JavaGenerator.prototype.generateCommonClasses = function() {
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

	this.fileWriter.write('pom.xml', this.templates.pom({
		groupId : this.groupId,
		artifactId : this.artifactId,
		name : this.name,
		version : this.version
	}));

	this.fileWriter.write(this.resourcesDir, 'checkstyle.xml', this.templates.checkstyle());

	this.fileWriter.write('.gitignore', this.templates.gitignore({}));
}

JavaGenerator.prototype.generateResource = function(name, resource) {
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

JavaGenerator.prototype.generateQueryBuilder = function(operation) {
	console.log('writing query builder ' + operation.queryBuilder);

	this.fileWriter.write(
		this.srcDir,
		operation.package.split('.').join('/'),
		operation.queryBuilder + '.java',
		this.templates.queryBuilder(operation));
}

JavaGenerator.prototype.generateModel = function(name, model) {
	console.log('writing model ' + name);

	this.fileWriter.write(
		this.srcDir,
		model.package.split('.').join('/'),
		model.name + '.java',
		this.templates.model(model));
}

JavaGenerator.prototype.generateHomeClass = function() {
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

JavaGenerator.prototype.generatePOM = function() {
	this.fileWriter.write('pom.xml', this.templates.pom({
		groupId : this.groupId,
		artifactId : this.artifactId,
		name : this.name,
		version : this.version
	}));

	this.fileWriter.write('.gitignore', this.templates.gitignore({}));
}

JavaGenerator.prototype.generateCheckStyle = function() {
	this.fileWriter.write(this.resourcesDir, 'checkstyle.xml', this.templates.checkstyle());
}

// Helpers
//

JavaGenerator.prototype.formatResourceName = function(string) {
    return this.capitalise(string);
}

JavaGenerator.prototype.formatModelName = function(string) {
    return this.capitalise(string);
}

JavaGenerator.prototype.formatParameterName = function(string) {
	if (string.startsWith("X-")) {
		string = string.substring(2);
	}

	var that = this;

	string = _.map(string.split('-'), function(part) { return that.capitalise(part); }).join('');
	string = this.uncapitalise(string);

    return string;
}

JavaGenerator.prototype.translateType = function(property, imports, resource) {
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

module.exports = JavaGenerator;