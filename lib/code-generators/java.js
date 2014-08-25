var util = require('util');
var _ = require('underscore');

var BaseGenerator = require('./base.js');

var imports = [];

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
}

var importMap = {
	'BigDecimal' : 'java.math.BigDecimal',
	'List' : 'java.util.List',
	'Set' : 'java.util.Set',
	'LocalDate' : 'org.joda.time.LocalDate',
	'DateTime' : 'org.joda.time.DateTime',
	'InputStream' : 'java.io.InputStream'
};

function JavaGenerator(config, templateEngine, fileWriter) {
	BaseGenerator.call(this, templateEngine, fileWriter);

	this.package = config.package || 'com.monarchapis.api';
	this.groupId = config.groupId || 'com.monarchapis';
	this.artifactId = config.artifactId || 'test-client';
	this.name = config.name || 'Test Client';
	this.version = config.version || '1.0';
	this.homeClass = config.homeClass || 'API';

	this.imports = _.clone(imports);
	this.resourceClasses = [];

	_.each(['model', 'resource', 'resourceAsync', 'apiHome', 'pom', 'checkstyle', 'gitignore'],
		_.bind(function(template) {
			this.templates[template] = this.loadTemplate(template + '.handlebars');
		}, this)
	);

	this.preventDeletion = ['.settings', '.project', '.classpath'];
}

util.inherits(JavaGenerator, BaseGenerator);

JavaGenerator.prototype.name = 'java';
JavaGenerator.prototype.templateDir = 'java';
JavaGenerator.prototype.srcDir = 'src/main/java';
JavaGenerator.prototype.resourcesDir = 'src/main/resources';

JavaGenerator.prototype.generate = function(swagger) {
	BaseGenerator.prototype.generate.call(this, swagger);

	_.each(this.resources, _.bind(function(resource, name) {
		this.generateResource(name, resource);
	}, this));


	this.generateModels();
	this.generateHomeClass();
	this.generatePOM();
	this.generateCheckStyle();
}

JavaGenerator.prototype.generateHomeClass = function() {
	var package = this.package + '.client';

	this.fileWriter.write(
		this.srcDir,
		package.split('.').join('/'),
		this.homeClass + '.java',
		this.templates.apiHome({
			package : package,
			className : this.homeClass,
			resourceClass : this.resourceClasses
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

JavaGenerator.prototype.generateResource = function(name, resource) {
	console.log('writing resource ' + name);

	var imports = ['java.util.List'];
	var asyncImports = [];

	var className = name + 'Resource';
	var asyncClassName = className + 'Async';

	this.resourceClasses.push(className);

	var methods = _.map(resource.operations, _.bind(function(operation) {
		var parameters = _.map(operation.parameters, _.bind(function(parameter) {
			var clientMethod = 'set' + this.capitalise(parameter.in);

			return {
				type : this.translateType(parameter, imports, true),
				required : parameter.required,
				name : parameter.name,
				clientMethod : clientMethod,
				// TODO base on consumes, but prefer JSON
				convertMethod : parameter.in == 'body' ? 'toJson' : null,
				named : parameter.in != 'body'
			};
		}, this));

		var okResponse = operation.responses && operation.responses["200"] ? operation.responses["200"].schema || {} : {};
		var returnType = this.translateType(okResponse, imports, true);
		var parseAs = "";

		if (returnType == "void") {
			this.addImport('com.monarchapis.client.rest.VoidCallback', asyncImports);
		}

		if (returnType.indexOf('<') == -1) {
			parseAs = returnType + '.class';
		} else {
			parseAs = 'new TypeReference<' + returnType + '>() {}';
			this.addImport('com.monarchapis.client.resource.TypeReference', imports);
		}

		return {
			path : operation.path,
			accepts : this.getMimeType(operation.produces),
			contentType : _.contains(['GET', 'DELETE'], operation.method) ? null : this.getMimeType(operation.consumes),
			comment : operation.summary,
			returnType : returnType,
			hasReturn : returnType != "void",
			parseAs : parseAs,
			operation : operation.operationId,
			method : operation.method,
			parameters : parameters
		};
	}, this));

	var package = this.package + '.client';

	var data = {
		package : package,
		imports : imports,
		asyncImports : asyncImports,
		className : className,
		methods : methods
	};

	this.fileWriter.write(
			this.srcDir,
			package.split('.').join('/'),
			className + '.java',
			this.templates.resource(data));

	data.className = asyncClassName;

	this.fileWriter.write(
			this.srcDir,
			package.split('.').join('/'),
			asyncClassName + '.java',
			this.templates.resourceAsync(data));
}

JavaGenerator.prototype.generateModels = function() {
	var models = _.map(this.models, _.bind(function(model, id) {
		return this.translateModel(model, id);
	}, this));

	_.each(models, _.bind(function(model) {
		console.log('writing model ' + model.id);
		var result = this.templates.model(model);
		this.fileWriter.write(
			this.srcDir,
			model.package.split('.').join('/'),
			model.id + '.java',
			result);
	}, this));
}

JavaGenerator.prototype.translateModel = function(model, id) {
	var imports = _.clone(this.imports);
	var properties = this.translateModelProperties(model.properties, imports);

	var className = id;

	// Customization: Generics type parameters
	//
	if (model.typeParameters && model.typeParameters.length > 0) {
		className += '<' + model.typeParameters.join(', ') + '>';
	}

	return {
		package : this.package + '.model',
		imports : imports,
		id : id,
		className : className,
		properties : properties
	};
}

JavaGenerator.prototype.translateModelProperties = function(properties, imports) {
	return _.map(properties, _.bind(function(property, name) {
		return this.translateModelProperty(name, property, imports);
	}, this));
}

JavaGenerator.prototype.translateModelProperty = function(name, property, imports) {
	var fieldAnnotations = [];
	var getterAnnotations = [];

	if (property.required) {
		fieldAnnotations.push('@NotNull');
		this.addImport('javax.validation.constraints.NotNull', imports);
	}

	var type = this.translateType(property, imports);

	if (type == "void") {
		console.log("null!!!");
	}

	return {
		name : name,
		description : property.description,
		type : type,
		defaultValue : property.defaultValue,
		required : property.required,
		fieldAnnotations : fieldAnnotations,
		getterAnnotations : getterAnnotations,
		getter : 'get' + this.capitalise(name),
		setter : 'set' + this.capitalise(name)
	};
}

JavaGenerator.prototype.translateType = function(property, imports, resource) {
	var type = null;

	if (property.type) {
		if (property.type == 'array') {
			type = property.uniqueItems ? 'Set' : 'List';

			if (property.items) {
				if (property.items.$ref) {
					var itemClass = convertReference(property.items.$ref);
					this.addImport(this.package + '.model.' + itemClass, imports);
					type += '<' + itemClass + '>';
				} else {
					type += '<' + this.translateType(property.items) + '>';
				}
			}
		} else {
			type = property.type;

			if (translateTypeMap[property.type]) {
				type = translateTypeMap[type];
			}

			if (translateFormatMap[property.format]) {
				type = translateFormatMap[property.format];
			}

			if (convertMap[type]) {
				type = convertMap[type];
			}

			this.addImport(importMap[type], imports);
		}
	} else if (property.schema && property.schema.$ref) {
		type = convertReference(property.schema.$ref);

		this.addImport(this.package + '.model.' + type, imports);

		// Customization: Generics type arguments
		//
		if (property.typeArguments && property.typeArguments.length > 0) {
			type += '<' + property.typeArguments.join(', ') + '>';
		}
	// Needed for response
	} else if (property.$ref) {
		type = convertReference(property.$ref);

		this.addImport(this.package + '.model.' + type, imports);

		// Customization: Generics type arguments
		//
		if (property.typeArguments && property.typeArguments.length > 0) {
			type += '<' + property.typeArguments.join(', ') + '>';
		}
	} else {
		type = "void";
	}

	if (!type) {
		console.log("null!!!");
	}

	return type;
}

JavaGenerator.prototype.addImport = function(className, imports) {
	imports = imports || this.imports;

	if (className && !_.contains(imports, className)) {
		imports.push(className);
	}
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

module.exports = JavaGenerator;