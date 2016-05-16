"use strict";
module.exports = function (options) {
	let filteredFileNames = new RegExp(options.ignoreFilesRegEx);

	return function (pr) {
		pr.filtered = !!(!pr.merged_at && pr.closed_at);
		if (pr.files) {
			pr.filtered = pr.files.every(file => filteredFileNames.test(file.filename));
		}
		return pr;
	};
};
