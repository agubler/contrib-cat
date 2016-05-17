"use strict";
const express = require("express");
const app = express();
const nunjucks = require("nunjucks");
const config = require("../config");
const ContribCat = require("../lib");
const mongoose = require('mongoose');
const moment = require("moment");
const marked = require("marked");
const contribCat = new ContribCat(config);
const User = require("./../lib/models/User");
const auth = require("http-auth");
const _ = require("lodash");
const path = require("path");

const port = 9000;
const env = nunjucks.configure("./templates", {
	autoescape: true,
	noCache: true,
	express: app
});

env.addFilter('githubPretty', str => str.replace(/.*?.com\//, "").replace(/#.*/, ""));
env.addFilter('githubLinkBuilder', str => config.githubUrl + "/" + str);
env.addFilter("marked", str => marked(str));
env.addFilter("formatDate", str => moment.utc(str).format('DD/MM/YYYY'));
env.addFilter('sentimentClass', str => {
	const val = parseInt(str);
	let className = "default";
	if (val < -1) {
		className = "danger";
	} else if (val < 0) {
		className = "warning";
	} else {
		className = "success";
	}
	return className;
});
env.addFilter("convertForChart", chartData => {
	const values = [];
	const labels = [];
	if (chartData) {
		chartData.forEach((data) => {
			values.push(data.scores.kudos);
			labels.push(moment.utc(data.date).format("MMM YYYY"));
		});
	}
	return {
		"values": values,
		"labels": labels
	};
});

app.use(express.static('./'));
app.use("/emojify", express.static("../node_modules/emojify.js/dist"));
app.use("/chartist", express.static("../node_modules/chartist/dist"));
app.use("/chartist", express.static("../node_modules/chartist-plugin-axistitle/dist"));
app.engine("html", nunjucks.render);
app.set("view engine", "html");

app.get("/user/:username", (req, res) => {
	let duration = req.query.duration || 365;
	let date = req.query.date ? moment.utc(req.query.date, "DD-MM-YYYY").toDate() : moment.utc().startOf("day").subtract(1, "days").toDate();
	let basicQuery = {
		"name": req.params.username.toLowerCase(),
		"duration": duration
	};
	let userQuery = {"date": date};
	let userTrendQuery = {
		"date": {
			"$lte": moment.utc(date).startOf("day").toDate(),
			"$gte": moment.utc(date).startOf("day").subtract(duration, "days").toDate()
		}
	};
	let commentPopulation = {
		path: 'repos.for repos.against',
		select: 'path body html_url user.login filtered'
	};
	let userDetailsPopulation = {"path": "details", "select": "avatar_url name created_at"};
	let chartFields = {
		"date": 1,
		"scores.kudos": 1,
		"_id": 0
	};

	User.findOne(_.merge(userQuery, basicQuery)).populate(userDetailsPopulation).populate(commentPopulation).lean().then((user) => {
		return User.find(_.merge(userTrendQuery, basicQuery), chartFields).lean().execAsync().then((trendData) => {
			if (user) {
				user.trendData = trendData;
			}
			return user;
		});
	}).then((user) => {
		res.render('user.html', {
			user: user,
			reports: config.reportDays,
			date: req.query.date
		});
	});
});

if (config.auth) {
	var basic = auth.basic({
		"realm": "Contrib Cat",
		"file": path.join(__dirname, "users.htpasswd")
	});
	app.use(auth.connect(basic));
}

app.get("/", (req, res) => {
	let duration = req.query.duration || 365;
	let date = req.query.date ? moment.utc(req.query.date, "DD-MM-YYYY").toDate() : moment.utc().subtract(1, "days").startOf("day").toDate();
	let query = {
		"date": date,
		"duration": duration
	};
	return User.find(query, {"scores": 1, "name": 1, "filtered": 1, "partial": 1}, {"sort": {"scores.kudos": -1}}).lean().then((users) => {
		res.render('index.html', {
			users: users,
			reports: config.reportDays,
			date: req.query.date
		});
	});
});

app.listen(port, () => {
	console.log("Listening on port %s...", port);
});
