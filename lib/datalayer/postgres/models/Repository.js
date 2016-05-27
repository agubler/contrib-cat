"use strict";

module.exports = function(sequelize, DataTypes) {
	const attributes = {

	};

	"id": Number,
		"name": String,
		"full_name": {"type": String, lowercase: true}

	const Repository = sequelize.define("Repository", attributes, {
		classMethods: {
			associate: models => {

			}
		}
	});

	return Repository;
};
