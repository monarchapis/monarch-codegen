var _ = require('underscore');
var fs = require('node-fs');
var path = require('path');

function FileWriter(baseDir) {
	this.baseDir = baseDir;
}

var preventDeletionGlobal = [/^\.git/, /^\.svn/];

deleteFolderRecursive = function(path, preventDeletion) {
	var canRemove = true;

	if (fs.existsSync(path)) {
		var files = fs.readdirSync(path);

		files.forEach(function(file,index){
			var curPath = path + "/" + file;

			for (var i=0; i<preventDeletion.length; i++) {
				var pattern = preventDeletion[i];

				if (pattern instanceof RegExp && pattern.test(file)) {
					canRemove = false;
					return;
				} else if (file == pattern) {
					canRemove = false;
					return;
				}
			}

			if (fs.lstatSync(curPath).isDirectory()) { // recurse
				if (!deleteFolderRecursive(curPath, preventDeletion)) {
					canRemove = false;
				}
			} else { // delete file
				fs.unlinkSync(curPath);
			}
		});

		if (canRemove) fs.rmdirSync(path);
	}

	return canRemove;
};

FileWriter.prototype.clean = function(prevent) {
	var preventDeletion = _.clone(preventDeletionGlobal);

	if (prevent) {
		_.each(prevent, function(p) { preventDeletion.push(p); });
	}

	deleteFolderRecursive(this.baseDir, preventDeletion);
}

FileWriter.prototype.write = function() {
	var parts = [this.baseDir];

	for (var i=0; i<arguments.length-2; i++) {
		parts.push(arguments[i]);
	}

	var dirname = path.resolve.apply(null, parts);
	var filename = arguments[arguments.length - 2];
	var content = arguments[arguments.length - 1];

	fs.mkdirSync(dirname, 0777, true);

	fs.writeFileSync(path.resolve(dirname, filename), content);
}

module.exports = FileWriter;