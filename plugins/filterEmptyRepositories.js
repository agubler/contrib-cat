"use strict";
module.exports = function(options) {
	return function (users) {
		users.forEach((user) => {
			user.repos.forEach((repo) => {
				repo.empty = !repo.prs.length && !repo.for.length && !repo.against.length;
			});
		});
		return users;
	};
};
