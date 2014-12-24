var Handlebars = require("handlebars");

Handlebars.registerHelper('modelLink', function(type, options) {
	var firstLetter = type.substring(0, 1);
	var conditional = firstLetter == firstLetter.toUpperCase();
	var html = '';

	if (conditional) {
		html += '<a class="model-link" href="#model_' + type + '">';
	}

	html += options.fn(this);

	if (conditional) {
		html += '</a>';
	}

	return html;
});

Handlebars.registerHelper('translate', function(value, options) {
	if (options.hash[value]) {
		value = options.hash[value];
	}

	return new Handlebars.SafeString(value);
});

var references = [];

Handlebars.registerHelper('reference', function(map, key, options) {
	var data = map ? map[key] : null;

	if (data) {
		return options.fn(data);
	} else {
		return options.inverse(this);
	}
});

Handlebars.registerHelper('addReference', function(id, options) {
	if (!_.contains(references, id)) {
		references.push(id);
	}
});

Handlebars.registerHelper('uppercase', function(value, options) {
	return value.toUpperCase();
});

function compile(source, noEscape) {
	return Handlebars.compile(source, { noEscape: noEscape || false });
}

module.exports.name = 'handlebars';
module.exports.extensions = ['.handlebars', '.hbs'];
module.exports.compile = compile;