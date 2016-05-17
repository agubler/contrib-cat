"use strict";
const _ = require("lodash");

module.exports = (array, batchSize, fn) => {
	const chunkedArray = _.chunk(array, batchSize);
	const first = chunkedArray.shift();

	return chunkedArray.reduce((defPrevious, current, currentIndex) => {
		return defPrevious.then(() => {
			console.log("Processing batch", currentIndex + 1, "of", chunkedArray.length);
			return fn(current);
		});
	}, fn(first));
};


