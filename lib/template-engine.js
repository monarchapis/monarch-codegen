var _ = require('underscore');
var fs = require('fs');
var path = require('path');

var TemplateEnginesByName = {};
var TemplateEnginesByExt = {};
var templateEnginesRoot = __dirname + '/template-engines/';

fs.readdirSync(templateEnginesRoot).forEach(function(file) {
	var engine = require(templateEnginesRoot + file);
	TemplateEnginesByName[engine.name] = engine.compile;

	_.each(engine.extensions, function(extension) {
		TemplateEnginesByExt[extension] = engine.compile;
	});
});

function compile(templateFile, noEscape) {
	var extension = path.extname(templateFile);
	var source = fs.readFileSync(templateFile, "utf8");
	
	return TemplateEnginesByExt[extension](source, noEscape || false);
}

module.exports.compile = compile;