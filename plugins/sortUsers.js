"use strict";
var _ = require("lodash");

module.exports = function (options) {
	return function (users) {
		users.sort(function (a, b) {
			if (_.get(a, options.sortField) > _.get(b, options.sortField)) {
				return 1;
			}
			if (_.get(a, options.sortField) < _.get(b, options.sortField)) {
				return -1;
			}
			return 0;
		});

		if (options.reverse) {
			users.reverse();
		}

		return users;
	}
};
