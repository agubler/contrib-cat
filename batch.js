"use strict";
var _ = require("lodash");

module.exports = function(array, batchSize, fn) {
	var chunkedArray = _.chunk(array, batchSize);
	var first = chunkedArray.shift();

	return chunkedArray.reduce((defPrevious, current, currentIndex) => {
		return defPrevious.then(() => {
			console.log("Processing batch", currentIndex + 1, "of", chunkedArray.length);
			return fn(current);
		});
	}, fn(first));
};


