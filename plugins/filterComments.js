"use strict";
module.exports = function (options) {

	return function(comment) {
		let emojiRegex = /(:.*?:)/g;
		let hasEmoji = emojiRegex.test(comment.body);
		let excludedWords = ["merge", "merging"];
		let commentBody = comment.body.replace(emojiRegex, "").trim();
		let filtered = false;

		if (commentBody.length < options.minLength) {
			filtered = true;
		}

		if (hasEmoji && excludedWords.find(excludedWord => comment.body.includes(excludedWord))) {
			filtered = true;
		}

		if (options.filterIssueOnly && comment.path) {
			filtered = false;
		}

		if (!commentBody.length) {
			filtered = true;
		}

		comment.filtered = filtered;
		return comment;
	};
};
