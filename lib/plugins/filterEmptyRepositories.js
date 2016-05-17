"use strict";

module.exports = options => {
	return users => {
		users.forEach((user) => {
			user.repos.forEach((repo) => {
				repo.empty = !repo.prs.length && !repo.for.length && !repo.against.length;
			});
		});
		return users;
	};
};
