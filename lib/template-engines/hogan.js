var hogan = require('hogan');

function compile(source) {
	return hogan.compile(source);
}

module.exports.name = 'hogan';
module.exports.extensions = ['.mustache', '.hogan'];
module.exports.compile = compile;