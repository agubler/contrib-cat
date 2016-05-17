"use strict";

module.exports = options => {
	var regExp;
	options = options || {};
	options.excludes = options.excludes || [];
	regExp = new RegExp(options.excludes.join("|"), "i");
	return function (users) {
		users.forEach(function (user) {
			user.for = user.for.filter(function (comment) {
				return !regExp.test(comment.body);
			});

			user.against = user.against.filter(function (comment) {
				return !regExp.test(comment.body);
			});
		});
		return users;
	};
};
