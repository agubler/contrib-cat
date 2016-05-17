"use strict";

module.exports = options => {
	return (comment) => {
		comment.filtered = options.excludes.indexOf(comment.user.login) > -1;
		return comment;
	};
};
