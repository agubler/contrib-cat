"use strict";
const analyze = require('Sentimental').analyze;
const emojify = require("emojify.js");

function scoreComment(previousValue, currentValue, weighting) {
	if (currentValue.filtered) {
		return previousValue;
	} else {
		return previousValue + (currentValue.path ? weighting.diff : weighting.issue);
	}
}

module.exports = options => {

	function scoreForComment(previousValue, currentValue) {
		return scoreComment(previousValue, currentValue, options.weighting.for);
	}

	function scoreAgainstComment(previousValue, currentValue) {
		return scoreComment(previousValue, currentValue, options.weighting.against);
	}

	return users => {
		users.forEach(user => {
			user.repos.forEach(repo => {
				repo.scores = {
					"kudos": 0,
					"prScore": 0,
					"prFilteredCount": 0,
					"forScore": 0,
					"againstScore": 0,
					"averageCommentsPerPr": 0,
					"sentiment": 0,
					"emojis": 0
				};

				repo.scores.prFilteredCount = repo.prs.filter(pr => pr.filtered).length;
				repo.scores.prScore = (repo.prs.length - repo.scores.prFilteredCount) * options.weighting.pr;

				repo.scores.againstScore = repo.against.reduce(scoreAgainstComment, 0);
				repo.scores.forScore = repo.for.reduce(scoreForComment, 0);

				const averageCommentsPerPr = repo.prs.length === 0 ? 0 : repo.against.length / repo.prs.length;
				repo.scores.averageCommentsPerPr = Math.ceil(averageCommentsPerPr);

				repo.scores.kudos = (repo.scores.againstScore + repo.scores.forScore) + repo.scores.prScore;
			});
		});
		return users;
	};
};
