"use strict";

module.exports = function(sequelize, DataTypes) {
	const attributes = {
		url: {
			type: DataTypes.STRING,
			allowNull: false,
			unique: true
		},
		html_url: {
			type: DataTypes.STRING
		},
		filtered: {
			type: DataTypes.BOOLEAN
		},
		path: {
			type: DataTypes.STRING
		},
		created_at: {
			type: DataTypes.DATE
		},
		updated_at: {
			type: DataTypes.DATE
		},
		body: {
			type: DataTypes.STRING
		}
	};

	const Comment = sequelize.define("Comment", attributes, {
		classMethods: {
			associate: models => {
				Comment.belongsTo(models.PullRequest, {
					foreignKey: {
						allowNull: false
					}
				});
			}
		}
	});

	return Comment;
};
