var util = require('util');
var _ = require('underscore');

var BaseGenerator = require('./base.js');

var translateTypeMap = {
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

	this.package = config.package || 'com.monarchapis.api';
	this.modelPackage = config.modelPackage || (this.package + '.model');
	this.clientPackage = config.clientPackage || (this.package + '.client');
	this.groupId = config.groupId || 'com.monarchapis';
	this.artifactId = config.artifactId || 'test-client';
	this.name = config.name || 'Test Client';
	this.version = config.version || '1.0';
	this.homeClass = config.homeClass || 'API';

	_.each(
		['model', 'resource', 'resourceAsync', 'apiHome', 'pom', 'checkstyle', 'gitignore'],
		_.bind(function(template) {
		this.templates[template] = this.loadTemplate(template + '.handlebars');
	}, this));

	this.preventDeletion = ['.settings', '.project', '.classpath'];
}

util.inherits(JavaGenerator, BaseGenerator);

JavaGenerator.prototype.name = 'java';
JavaGenerator.prototype.templateDir = 'java';
JavaGenerator.prototype.srcDir = 'src/main/java';
JavaGenerator.prototype.resourcesDir = 'src/main/resources';

// Enhancements to the data structure prior to template execution
//

JavaGenerator.prototype.decorateResource = function(resource, name) {
	return {
		package : this.clientPackage,
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

	return {
		type : this.translateType(parameter, resource.imports, true),
		clientMethod : clientMethod,
		// TODO base on consumes, but prefer JSON
		convertMethod : parameter.in == 'body' ? 'toJson' : null,
		named : parameter.in != 'body'
	};
}

JavaGenerator.prototype.decorateModel = function(model) {
	var className = model.name;

	// Customization: Generics type parameters
	//
	if (model['x-typeParameters'] && model['x-typeParameters'].length > 0) {
		className += '<' + model['x-typeParameters'].join(', ') + '>';
	}

	return {
		package : this.modelPackage,
		className : className
	};
}

JavaGenerator.prototype.decorateProperty = function(property, model) {
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

JavaGenerator.prototype.generate = function() {
	_.each(this.resources, _.bind(function(resource, name) {
		this.generateResource(name, resource);
	}, this));

	_.each(this.models, _.bind(function(model, name) {
		this.generateModel(name, model);
	}, this));


	this.generateHomeClass();
	this.generatePOM();
	this.generateCheckStyle();
}

JavaGenerator.prototype.generateResource = function(name, resource) {
	console.log('writing resource ' + name);

	this.fileWriter.write(
			this.srcDir,
			resource.package.split('.').join('/'),
			resource.className + '.java',
			this.templates.resource(resource));

	var async = _.clone(resource);

	async.className += 'Async';

	this.fileWriter.write(
			this.srcDir,
			async.package.split('.').join('/'),
			async.className + '.java',
			this.templates.resourceAsync(async));
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

JavaGenerator.prototype.translateType = function(property, imports, resource) {
	var type = null;

	if (property.type) {
		if (property.type == 'array') {
			type = property.uniqueItems ? 'Set' : 'List';

			if (property.items) {
				if (property.items.$ref) {
					var itemClass = this.getReferenceName(property.items.$ref);
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
		type = this.getReferenceName(property.$ref || property.schema.$ref);

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