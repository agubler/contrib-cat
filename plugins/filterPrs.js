"use strict";
module.exports = function (options) {
	let filteredFileNames = new RegExp(options.ignoreFilesRegEx);

	return function (results) {
		results.users.forEach((user) => {
			user.repos.forEach((repo) => {
				repo.prs.forEach((pr) => {
					pr.filtered = !!(!pr.merged_at && pr.closed_at);
					if (pr.files) {
						pr.filtered = pr.files.every(file => filteredFileNames.test(file.filename));
					}
				});
			});
		});
		return results;
	};
};
