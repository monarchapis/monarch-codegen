var jade = require('jade');

function compile(source) {
	return jade.compile(source);
}

module.exports.name = 'jade';
module.exports.extensions = ['.jade'];
module.exports.compile = compile;