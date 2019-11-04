"use strict";
var analyze = require('Sentimental').analyze;
var emojify = require("emojify.js");
var moment = require("moment");

function scoreComment(previousValue, currentValue, weighting) {
	if (currentValue.filtered) {
		return previousValue;
	} else {
		return previousValue + (currentValue.path ? weighting.diff : weighting.issue);
	}
}

function getDays(start, end) {
	let startDate = moment(new Date(start)).startOf("day");
	let endDate = moment(new Date(end)).startOf("day");
	let dates = [];
	while (startDate.isAfter(endDate)) {
	  dates.push(startDate.toDate().getTime());
	  start = startDate.add(1, "day").startOf('day');
	}
	return dates;
  }

module.exports = function (options) {

	function scoreForComment(previousValue, currentValue) {
		return scoreComment(previousValue, currentValue, options.weighting.for);
	}

	function scoreAgainstComment(previousValue, currentValue) {
		return scoreComment(previousValue, currentValue, options.weighting.against);
	}

	return function (results) {
		results.users.forEach(function (user) {
			user.repos.forEach((repo) => {
				repo.scores = {
					"kudos": 0,
					"prScore": 0,
					"mergedPrs": 0,
					"forScore": 0,
					"againstScore": 0,
					"averageCommentsPerPr": 0,
					"sentiment": 0,
					"emojis": 0
				};
				
				const filteredPrs = repo.prs.filter((pr) => {
					return pr.state === 'closed' && pr.merged_at;
				});

				repo.scores.prScore = filteredPrs.length * options.weighting.pr;
				repo.scores.mergedPrs = filteredPrs.length;

				repo.scores.againstScore = repo.against.reduce(scoreAgainstComment, 0);
				repo.scores.forScore = repo.for.reduce(scoreForComment, 0);
				let earliestPR = new Date();
				let latestPR = new Date(1900, 0, 0);
				let daysActive = [];
				for (let i = 0; i < repo.prs.length; i++) {
					if (repo.prs[i].closed_at) {
						daysActive = [ ...daysActive, ...getDays(repo.prs[i].created_at, repo.prs[i].closed_at) ];
					}
					const createdDate = new Date(repo.prs[i].created_at);
					if (createdDate.getTime() < earliestPR.getTime()) {
						earliestPR = createdDate;
					}
					if (createdDate.getTime() > latestPR.getTime()) {
						latestPR = createdDate;
					}
				}

				daysActive = new Set(daysActive);

				repo.for.forEach(function (comment) {
					var sentiment = analyze(comment.body).score;
					repo.scores.sentiment += sentiment;
					emojify.replace(comment.body, function () {
						repo.scores.emojis += 1;
					});
					comment.sentiment = sentiment;
				});

				let averageCommentsPerPr = repo.prs.length === 0 ? 0 : repo.against.length / repo.prs.length;
				repo.scores.averageCommentsPerPr = Math.ceil(averageCommentsPerPr);
				repo.scores.start = earliestPR;
				repo.scores.end = latestPR;
				repo.daysActive = daysActive;
				repo.scores.kudos = (repo.scores.againstScore + repo.scores.forScore) + repo.scores.prScore;
			});
		});
		return results;
	};
};
