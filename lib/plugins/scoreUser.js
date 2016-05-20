"use strict";
const moment = require("moment");

module.exports = options => {

	return users => {
		users.forEach(user => {
			user.scores = {
				"kudos": 0,
				"prScore": 0,
				"forScore": 0,
				"againstScore": 0,
				"prCount": 0,
				"prFilteredCount": 0,
				"forTotalCount": 0,
				"forFilteredCount": 0,
				"forUnfilteredCount": 0,
				"againstTotalCount": 0,
				"againstFilteredCount": 0,
				"againstUnfilteredCount": 0,
				"sentiment": 0,
				"emojis": 0
			};

			user.repos.forEach((repo) => {
				user.scores.kudos += repo.scores.kudos;
				user.scores.prScore += repo.scores.prScore;
				user.scores.forScore += repo.scores.forScore;
				user.scores.againstScore += repo.scores.againstScore;
				user.scores.prCount += repo.prs.length;
				user.scores.prFilteredCount += repo.scores.prFilteredCount;
				user.scores.forTotalCount += repo.for.length;
				user.scores.forFilteredCount += repo.for.filter(comment => comment.filtered).length;
				user.scores.forUnfilteredCount += repo.for.filter(comment => !comment.filtered).length;
				user.scores.againstTotalCount += repo.against.length;
				user.scores.againstFilteredCount += repo.against.filter(comment => comment.filtered).length;
				user.scores.againstUnfilteredCount += repo.against.filter(comment => !comment.filtered).length;
				user.scores.emojis += repo.scores.emojis;
				user.scores.sentiment += repo.scores.sentiment;
			});

			let averageCommentsPerPr = user.scores.prCount === 0 ? 0 : user.scores.againstTotalCount / user.scores.prCount;
			user.scores.averageCommentsPerPr = Math.ceil(averageCommentsPerPr);
			user.scores.averageCommentsPerPrForSort = averageCommentsPerPr;

			const created = moment(user.details.created_at).startOf("day");
			const reportDate = moment(user.date).startOf("day").subtract(user.duration, "days");
			const after = created.isAfter(reportDate);

			if (after) {
				const days = created.diff(reportDate, "days");
				const average = user.scores.kudos/(user.duration - days);
				user.partial = true;
				user.scores.originalKudos = user.scores.kudos;
				user.scores.kudos = Math.round(average * user.duration);
			}
		});
		return users;
	};
};
