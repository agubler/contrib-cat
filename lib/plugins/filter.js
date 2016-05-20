"use strict";

module.exports = options => {
	options = options || {};
	options.excludes = options.excludes || [];
	const regExp = new RegExp(options.excludes.join("|"), "i");
	return function (users) {
		users.forEach(function (user) {
			user.for = user.for.filter(comment => {
				return !regExp.test(comment.body);
			});

			user.against = user.against.filter(comment => {
				return !regExp.test(comment.body);
			});
		});
		return users;
	};
};
