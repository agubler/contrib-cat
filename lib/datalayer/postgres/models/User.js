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

	const User = sequelize.define("User", attributes, {
		classMethods: {
			associate: models => {
				User.hasMany(models.Comment, {
					onDelete: "CASCADE",
					foreignKey: {
						allowNull: false
					}
				});
			}
		}
	});

	return User;
};
