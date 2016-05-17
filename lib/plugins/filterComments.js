"use strict";

module.exports = options => {

	return comment => {
		const emojiRegex = /(:.*?:)/g;
		const hasEmoji = emojiRegex.test(comment.body);
		const excludedWords = ["merge", "merging"];
		const commentBody = comment.body.replace(emojiRegex, "").trim();
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
