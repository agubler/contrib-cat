import express from 'express';
import nunjucks from 'nunjucks';
import moment from 'moment';
import * as path from 'path';

import config from './config';
import contribCat from './main';

const app = express();
const port = 9000;
const contrib = contribCat(config);

const env = nunjucks.configure(path.join(__dirname, 'templates'), {
	autoescape: true,
	noCache: true,
	express: app
});

env.addFilter('githubPretty', function(str) {
	return str.replace(/.*?.com\//, '').replace(/#.*/, '');
});

// env.addFilter('githubLinkBuilder', function(str) {
// 	return config.githubUrl + "/" + str;
// });

env.addFilter('sentimentClass', function(str) {
	var val = parseInt(str);
	var className = 'default';
	if (val < -1) {
		className = 'danger';
	} else if (val < 0) {
		className = 'warning';
	} else {
		className = 'success';
	}
	return className;
});

// env.addFilter("marked", function (str) {
// 	return marked(str);
// });

env.addFilter('formatDate', function(str) {
	return moment(str).format('DD/MM/YYYY');
});

app.use(express.static(__dirname));
app.use('/emojify', express.static('../node_modules/emojify.js/dist'));

app.engine('html', nunjucks.render);
app.set('view engine', 'html');

// app.get("/user/:username", (req, res) => {
// 	var sinceQuery = {
// 		$gt: moment().startOf("day").subtract(config.reportDays, "days").toDate()
// 	};

// 	User.findOne({"name": req.params.username.toLowerCase()}, {"repos.prs": 0}).populate({
// 			path: 'repos.prs',
// 			match: { "created_at": sinceQuery }})
// 		.populate({
// 			path: 'repos.for repos.against',
// 			match: { "updated_at": sinceQuery },
// 			select: 'path body html_url user.login filtered'})
// 		.lean().then((user) => {
// 		res.render('user.html', {
// 			user: user
// 		});
// 	});
// });

app.get('/', async (req, res) => {
	const users = await contrib.report();
	console.log('users', users);
	res.render('index.html', {
		users
	});
});

app.listen(port, () => {
	console.log('Listening on port %s...', port);
});
