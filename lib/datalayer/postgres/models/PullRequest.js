"use strict";

module.exports = function(sequelize, DataTypes) {
	const attributes = {
		url: {
			type: DataTypes.STRING,
			primaryKey: true,
			allowNull: false,
			unique: true
		}
	};

	const PullRequest = sequelize.define("PullRequest", attributes, {
		classMethods: {
			associate: models => {
				PullRequest.hasMany(models.Comment, {
					onDelete: "CASCADE",
					foreignKey: {
						allowNull: false
					}
				});
			}
		}
	});

	return PullRequest;
};
