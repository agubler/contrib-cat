"use strict";
const _ = require("lodash");

module.exports = users => {
	users.forEach(user => {
		user.repos.sort(function (a, b) {
			if (a.scores.kudos > b.scores.kudos) {
				return 1;
			}
			if (a.scores.kudos < b.scores.kudos) {
				return -1;
			}
			return 0;
		}).reverse();

		let bestRepoCount = user.repos.length < 3 ? 1 : user.repos.length < 5 ? 2 : 3;
		let clonedRepos = user.repos.filter(repo => !repo.empty);

		user.strongestRepos = clonedRepos.splice(0, bestRepoCount);
		user.weakestRepos = _.takeRight(clonedRepos, bestRepoCount).reverse();
	});

	return users;
};
