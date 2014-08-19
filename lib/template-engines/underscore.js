var _ = require('underscore');

function compile(source) {
	return _.template(source);
}

module.exports.name = 'underscore';
module.exports.extensions = ['.tmpl', '.template'];
module.exports.compile = compile;