"use strict";
const request = require("request");
const moment = require("moment");
const Promise = require('bluebird');
const _ = require("lodash");
const linkParser = require('parse-link-header');
const mongoose = require('mongoose');
const requestDefaults = request.defaults({"json": true});
const get = Promise.promisify(requestDefaults.get, {multiArgs: true});
const UserDetails = require("./models/UserDetails");
const PullRequest = require("./models/PullRequest").PullRequest;
const Comment = require("./models/Comment");
const User = require("./models/User");
const batch = require("./utils/batch");

const connectionTemplate = _.template("mongodb://${url}/${db}");
const getUserTemplate = _.template("${apiUrl}/users/${username}");
const getAllUsersTemplate = _.template("${apiUrl}/users");
const getPullsTemplate = _.template("${apiUrl}/repos/${org}/${repo}/pulls?page=${page}&per_page=${size}&state=all&base=${head}&sort=updated&direction=desc");
const getPullRequestFilesTemplate = _.template("${apiUrl}/repos/${repo}/pulls/${number}/files");

const modelMap = {
	"comments": Comment,
	"pullRequests": PullRequest
};

const findAndUpdateOptions  = {
	"upsert": true,
	"new": true
};

const maxSyncDate = moment.utc().endOf("day").subtract(1, "days");
let minSyncDate = moment.utc().startOf("day").subtract(1, "days");

Promise.promisifyAll(mongoose);

function generateArrayOfDates(fromDate) {
	let dateArray = [];
	let dateToCheck;
	for (dateToCheck = moment.utc(fromDate); dateToCheck.isSameOrBefore(maxSyncDate); dateToCheck.add(1, 'days')) {
		dateArray.push(moment.utc(dateToCheck).endOf("day"));
	}
	return dateArray.reverse();
}

module.exports = class ContribCat {

	constructor(config) {
		this.config = config;
		this.reposQuery = {"$or": this.config.repos.map(repo => { return {"base.repo.full_name": repo.toLowerCase()}})};
		if (this.config.syncDays) {
			minSyncDate = moment.utc().startOf("day").subtract(this.config.syncDays, "days");
		}
		mongoose.connect(connectionTemplate(this.config.store), { keepAlive: 120 });
	}

	load(overrideMinSyncDate) {
		minSyncDate = overrideMinSyncDate || minSyncDate;
		return this._fetchUsers()
			.then(this._loadPullRequests.bind(this))
			.then(this._loadPullRequestFiles.bind(this))
			.then(this._loadPullRequestComments.bind(this, "comment"))
			.then(this._loadPullRequestComments.bind(this, "issue"))
			.then(() => {
				return overrideMinSyncDate;
			});
	}

	sync(overrideMinSyncDate) {
		minSyncDate = overrideMinSyncDate || minSyncDate;
		return Promise.each(generateArrayOfDates(minSyncDate), (date) => {
			console.log("Creating user statistics for", date.toString());

			return Promise.each(this.config.reportDays, (days) => {
				console.log("Generating report for", days, "days");
				return this._createUsers(days, date)
					.then(this._runPlugins.bind(this, "users"))
					.then(this._saveUsers.bind(this));
			});
		});
	}
	
	disconnect() {
		return mongoose.disconnect();
	}

	_fetchUsers(url) {
		if (!url) {
			console.log("Fetching user details");
			url = getAllUsersTemplate({"apiUrl": this.config.apiUrl});
		}
		return get(url).spread((response, body) => {
			let links = linkParser(response.headers.link);

			return Promise.map(body, (userDetails) => {
				userDetails.login = userDetails.login.toLowerCase();
				return get(getUserTemplate({
					"apiUrl": this.config.apiUrl,
					"username": userDetails.login
				})).spread((response, body) => {
					return UserDetails.findOneAndUpdate({"login": body.login}, body, findAndUpdateOptions).execAsync().reflect();
				});
			}).then(() => {
				if (links && links.next) {
					return this._fetchUsers(links.next.url);
				}
			});
		});
	}

	_fetch(url, type, preProcessor, doNextPage) {
		return get(url).spread((response, body) => {
			const links = linkParser(response.headers.link);
			let items = _.cloneDeep(body);

			if (typeof preProcessor === "function") {
				items = items.filter(preProcessor);
			}

			if (!doNextPage || typeof doNextPage !== "function") {
				doNextPage = () => true;
			}

			return Promise.map(items, (item) => {
				return this._runPlugins(type, item).then((item) => {
					return modelMap[type].findOneAndUpdate({"url": item.url}, item, findAndUpdateOptions).execAsync().reflect();
				});
			}).then(() => {
				if (links && links.next && doNextPage(body, items)) {
					return this._fetch(links.next.url, type, preProcessor, doNextPage);
				}
			});
		});
	}

	_loadPullRequests() {
		const preProcessor = item => {
			item.base.repo.full_name = item.base.repo.full_name.toLowerCase();
			item.user.login = item.user.login.toLowerCase();
			return moment.utc(item.updated_at).isAfter(minSyncDate);
		};
		const doNextPage = (originalPrs, filterPrs) => {
			return originalPrs.length === filterPrs.length;
		};

		console.log("Fetching pull requests updated since", minSyncDate.toString());

		return Promise.all(this.config.repos.map((target) => {
			const parts = target.split(":");
			const head = parts[1];
			const repo = parts[0];
			const url = getPullsTemplate({
				"apiUrl": this.config.apiUrl,
				"org": repo.split("/")[0],
				"repo": repo.split("/")[1],
				"head": head || this.config.defaultBranch,
				"page": 1,
				"size": this.config.pageSize
			});
			return this._fetch(url, "pullRequests", preProcessor, doNextPage);
		})).then(() => {
			return PullRequest.find(Object.assign({updated_at: {$gt: minSyncDate.toDate()}}, this.reposQuery)).lean().execAsync();
		});
	}

	_loadPullRequestFiles(prs) {
		console.log("Fetching files for", prs.length, "prs");
		return batch(prs, 15, (prBatch) => {
			return Promise.map(prBatch, (pr) => {
				const url = getPullRequestFilesTemplate({
					"apiUrl": this.config.apiUrl,
					"repo": pr.base.repo.full_name,
					"number": pr.number
				});
				return get(url).then((response) => {
					pr.files = response[1];
					return this._runPlugins("pullRequests", pr).then((pr) => {
						return PullRequest.findOneAndUpdate({"_id": pr._id}, pr, findAndUpdateOptions).execAsync().reflect();
					});
				});
			}).then(() => {
				return prs;
			});
		})
	};

	_loadPullRequestComments(type, prs) {
		console.log("fetching", type, "comments for", prs.length, "prs");
		return batch(prs, 10, (prBatch) => {
			return Promise.map(prBatch, (pr) => {
				const prUrl = type === "comment" ? pr.review_comments_url : pr.comments_url;
				const preProcessor = item => {
					item.user.login = item.user.login.toLowerCase();
					if (!item.pull_request_url) {
						item.pull_request_url = pr.url;
					}
					return true;
				};

				return this._fetch(prUrl, "comments", preProcessor);
			}).then(() => {
				return prs;
			});
		});
	}

	_lookUpUserStatistic(reportDate, reportLength) {
		let users = [];
		console.time("lookUpUserStatistics");
		return UserDetails.find().lean().execAsync().map(userDetails => {
			var userQuery = {
				"name": userDetails.login.toLowerCase(),
				"date": moment.utc(reportDate).startOf("day"),
				"duration": reportLength
			};

			return User.findOne(userQuery).populate({
				path: 'repos.for repos.against',
				select: 'path body html_url user.login filtered'
			}).populate({
				path: 'repos.pr',
				select: 'filtered'
			}).lean().then(user => {
				if (!user) {
					users.push(new User({
						"name": userDetails.login.toLowerCase(),
						"date": moment.utc(reportDate).startOf("day"),
						"duration": reportLength,
						"details": userDetails,
						"repos": []
					}));
				} else {
					users.push(user);
				}
			});
		}).then(() => {
			users = _.keyBy(users, "name");
			console.timeEnd("lookUpUserStatistics");
			return users;
		});
	}

	_createUsers(reportLength, maxDate) {
		let minDate = moment.utc(maxDate).startOf("day").subtract(reportLength, "days");
		return this._lookUpUserStatistic(maxDate, reportLength).then(users => {
			const dateQuery = {
				updated_at: {
					$gte: minDate.toDate(),
					$lte: maxDate.toDate()
				}
			};

			console.time("look up comments for report date", maxDate.toString(), "with report length", reportLength);
			return Comment.find(
				dateQuery,
				{
					"pull_request_url": 1,
					"user.login": 1,
					"filtered": 1,
					"body": 1,
					"url": 1
				}
			).lean().execAsync().then((comments) => {
				console.timeEnd("look up comments for report date", maxDate.toString(), "with report length", reportLength)
				comments = _.groupBy(comments, "pull_request_url");

				return PullRequest.find(
					Object.assign({}, this.reposQuery, dateQuery),
					{
						"user.login": 1,
						"filtered": 1,
						"base.repo.full_name": 1,
						"created_at": 1,
						"url": 1
					}
				).lean().execAsync().map((pr) => {
					const author = pr.user.login;
					let authorRepo = _.find(users[author].repos, {'name': pr.base.repo.full_name});

					if (!authorRepo) {
						authorRepo = {
							"name": pr.base.repo.full_name,
							"prs": [],
							"for": [],
							"against": []
						};
						users[author].repos.push(authorRepo);
					}
					if (moment(pr.created_at).isAfter(minDate)) {
						if (_.findIndex(authorRepo.prs, o => pr._id.equals(o)) === -1) {
							authorRepo.prs.push(pr);
						}
					}
					let prComments = comments[pr.url];
					if (prComments) {
						prComments.forEach((comment) => {
							let commenter = comment.user.login;
							let commenterRepo = _.find(users[commenter].repos, {'name': pr.base.repo.full_name});

							if (!commenterRepo) {
								commenterRepo = {
									"name": pr.base.repo.full_name,
									"prs": [],
									"for": [],
									"against": []
								};
								users[commenter].repos.push(commenterRepo);
							}

							if (comment.user.login !== author) {
								if (_.findIndex(authorRepo.against, o => comment._id.equals(o._id)) === -1) {
									authorRepo.against.push(comment);
								}

								if (_.findIndex(commenterRepo.for, o => comment._id.equals(o._id)) === -1) {
									commenterRepo.for.push(comment);
								}
							}
						});
					}
				}).then(() => {
					return _.values(users);
				});
			});
		});
	}

	_saveUsers(users) {
		console.log("saving", users.length, "users");
		return Promise.map(users, (user) => {
			const query = {
				"name": user.name,
				"date": user.date,
				"duration": user.duration
			};

			return User.findOneAndUpdate(query, user, findAndUpdateOptions).execAsync().reflect();
		}).then(() => {
			console.timeEnd("save users");
		});
	}

	_runPlugins(type, result) {
		return Promise.each(this.config.plugins[type], (plugin, index) => {
			console.time("plugin " + plugin.name + index);
			let pluginResult = plugin(result);
			console.timeEnd("plugin " + plugin.name + index);
			return pluginResult;
		}).then(() => {
			return result;
		});
	}
};
