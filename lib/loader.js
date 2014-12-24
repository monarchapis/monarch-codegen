var _ = require('underscore');
var $ = require('jquery-deferred');
var request = require('request');
var fs = require('fs');
var path = require('path');
var jsyaml = require('js-yaml');

var yamlMimes = ['text/yaml', 'text/x-yaml', 'application/yaml', 'application/x-yaml'];

var convertors = [];
var templateEnginesRoot = __dirname + '/convertors/';

fs.readdirSync(templateEnginesRoot).forEach(function(file) {
	var convertor = require(templateEnginesRoot + file);
	convertors.push(convertor);
});

module.exports = function(url, callback) {
	var promiseMap = {};
	var urlMap = {};
	var failure = false;

	var loadReferences = function(url, root, doc, parentObj, parentKey) {
		_.each(doc, function(value, key) {
			if (key == "$ref" && _.isString(value) && !value.startsWith('#')) {
				var parts = value.split('#');
				var href = parts[0];
				var path = parts.length > 1 ? parts[1] : null;

				if (path) {
					while (path.startsWith('/')) path = path.substring(1);
					path = path.split(/\./g);
				}

				if (href.startsWith('http:') || href.startsWith('https:')) {
					var promise = promiseMap[href];

					if (promise == null) {
						promise = $.Deferred();
						promiseMap[href] = promise;

						console.log('importing ' + href);
						request(href, function (error, response, body) {
							if (!error && response && response.statusCode == 200) {
								var contentType = response.headers['content-type'];
								if (contentType) contentType = contentType.split(';')[0];
								var data = _.contains(yamlMimes, contentType) ? jsyaml.load(body) : JSON.parse(body);

								urlMap[href] = data;
								loadReferences(href, data, data);

								promise.resolve(data);
							} else if (response) {
								promise.reject("error " + response.statusCode);
							} else {
								promise.reject("connection refused: " + error);
							}
						});
					}
				}
			} else if (_.isObject(value)) {
				loadReferences(url, root, value, doc, key);
			}
		});
	};

	function load(data) {
		var promise = $.Deferred();
		promise.resolve(data);
		promiseMap[url] = promise;
		urlMap[url] = data;
		urlMap.root = data;

		loadReferences(url, data, data);

		$.when.apply(null, _.values(promiseMap)).done(function() {
			callback(urlMap);
		}).fail(function() {
			callback(null, "failed to retrieve one or more external references");
		});
	}

	request(url, function (error, response, body) {
		if (!error && response && response.statusCode == 200) {
			var contentType = response.headers['content-type'];
			if (contentType) contentType = contentType.split(';')[0];
			var data = _.contains(yamlMimes, contentType) ? jsyaml.load(body) : JSON.parse(body);

			if (data.swagger && data.swagger == 2.0) {
				load(data);
			} else {
				for (var i=0; i<convertors.length; i++) {
					var convertor = convertors[i];

					if (convertor.applies(data)) {
						console.log('converting ' + convertor.sourceVersion + ' to Swagger 2.0.');
						convertor.convert(url, data, function(data, error) {
							if (data) {
								load(data);
							} else {
								callback(null, error);
							}
						});

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