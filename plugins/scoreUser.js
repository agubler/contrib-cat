"use strict";
var moment = require("moment");

module.exports = function(options) {
  return function(results) {
    results.users.forEach(function(user) {
      user.scores = {
        kudos: 0,
        prScore: 0,
        forScore: 0,
        againstScore: 0,
        prCount: 0,
        totalPrs: 0,
        mergedPrs: 0,
        forTotalCount: 0,
        forFilteredCount: 0,
        forUnfilteredCount: 0,
        againstTotalCount: 0,
        againstFilteredCount: 0,
        againstUnfilteredCount: 0,
        sentiment: 0,
        activeDays: 0,
        emojis: 0
      };

      let userStartDate = new Date();
      let userEndDate = new Date(1900, 0, 0);
      let userDaysActive = new Set();

      user.repos.forEach(repo => {
        user.scores.kudos += repo.scores.kudos;
        user.scores.prScore += repo.scores.prScore;
        user.scores.forScore += repo.scores.forScore;
        user.scores.againstScore += repo.scores.againstScore;
        user.scores.prCount += repo.scores.mergedPrs;
        user.scores.totalPrs += repo.prs.length;
        // console.log('merged', repo.scores.mergedPrs);
        user.scores.mergedPrs += repo.scores.mergedPrs
        user.scores.forTotalCount += repo.for.length;
        user.scores.forFilteredCount += repo.for.filter(
          comment => comment.filtered
        ).length;
        user.scores.forUnfilteredCount += repo.for.filter(
          comment => !comment.filtered
        ).length;
        user.scores.againstTotalCount += repo.against.length;
        user.scores.againstFilteredCount += repo.against.filter(
          comment => comment.filtered
        ).length;
        user.scores.againstUnfilteredCount += repo.against.filter(
          comment => !comment.filtered
        ).length;
        user.scores.emojis += repo.scores.emojis;
        user.scores.sentiment += repo.scores.sentiment;
        if (repo.scores.start.getTime() < userStartDate.getTime()) {
          userStartDate = repo.scores.start;
        }
        if (repo.scores.end.getTime() > userEndDate.getTime()) {
          userEndDate = repo.scores.end;
        }
        user.scores.activeDays += repo.daysActive.size;
        console.log(user.name, repo.daysActive.size);
       });

      let averageCommentsPerPr =
        user.scores.prCount === 0
          ? 0
          : user.scores.againstTotalCount / user.scores.prCount;
      user.scores.averageCommentsPerPr = Math.ceil(averageCommentsPerPr);
      user.scores.averageCommentsPerPrForSort = averageCommentsPerPr;

      var created = moment(userStartDate).startOf("day");
      var after = created.isAfter(results.startDate);

      console.log(user.name, userStartDate, userEndDate, user.scores.totalPrs);
      user.scores.originalKudos = user.scores.kudos;

        // var days = created.diff(results.startDate, "days");
        var average = user.scores.kudos / user.scores.activeDays;
        if (user.scores.totalPrs > 2) {
        user.scores.kudos = Math.round(average * results.reportDays);
        } else {
          user.partial = true;
          user.scores.kudos = -Infinity;
        }
    });
    return results;
  };
};
