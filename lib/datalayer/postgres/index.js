const fs        = require("fs");
const path      = require("path");
const Sequelize = require("sequelize");

module.exports = (config) => {
	const sequelize = new Sequelize(config.database, config.username, config.password, config);
	const db = {};

	fs.readdirSync(path.join(__dirname, "models"))
		.filter(file => file.indexOf(".") !== 0 && file !== "index.js")
		.forEach(file => {
			const model = sequelize.import(path.join(__dirname, file));
			db[model.name] = model;
		});

	Object.keys(db).forEach(modelName => {
		if ("associate" in db[modelName]) {
			db[modelName].associate(db);
		}
	});

	db.sequelize = sequelize;
	db.Sequelize = Sequelize;

	return db;
};
