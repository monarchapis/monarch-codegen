var request = require('request');
var _ = require('underscore');
var fs = require('fs');
var path = require('path');

var yamlMimes = ['text/yaml', 'text/x-yaml', 'application/yaml', 'application/x-yaml'];

var convertors = [];
var templateEnginesRoot = __dirname + '/convertors/';

fs.readdirSync(templateEnginesRoot).forEach(function(file) {
	var convertor = require(templateEnginesRoot + file);
	convertors.push(convertor);
});

module.exports = function(url, callback) {
	request(url, function (error, response, body) {
		if (!error && response && response.statusCode == 200) {
			var contentType = response.headers['content-type'];
			if (contentType) contentType = contentType.split(';')[0];
			var data = _.contains(yamlMimes, contentType) ? jsyaml.load(body) : JSON.parse(body);

			if (data.info && data.info.version && data.info.version == 2.0) {
				callback(data);
			} else {
				for (var i=0; i<convertors.length; i++) {
					var convertor = convertors[i];

					if (convertor.applies(data)) {
						console.log('converting ' + convertor.sourceVersion + ' to Swagger 2.0.');
						convertor.convert(url, data, callback);

						return;
					}
				}

				callback(null, "could not find suitable convertor");
			}
		} else if (response) {
			callback(null, "error " + response.statusCode);
		} else {
			callback(null, "connection refused: " + error);
		}
	});
}