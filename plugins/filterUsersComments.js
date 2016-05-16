"use strict";

module.exports = function (options) {
	return function (comment) {
		comment.filtered = options.excludes.indexOf(comment.user.login) > -1;
		return comment;
	};
};
