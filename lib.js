"use strict";
var request = require("request");
var moment = require("moment");
var Promise = require('bluebird');
var _ = require("lodash");
var linkParser = require('parse-link-header');
var mongoose = require('mongoose');
var requestDefaults = request.defaults({"json": true});
var get = Promise.promisify(requestDefaults.get, {multiArgs: true});
var UserDetails = require("./models/UserDetails");
var PullRequest = require("./models/PullRequest").PullRequest;
var batch = require("./batch");
var Comment = require("./models/Comment");
var User = require("./models/User");
var connectionTemplate = _.template("mongodb://${url}/${db}");

Promise.promisifyAll(mongoose);

const getUserTemplate = _.template("${apiUrl}/users/${username}");
const getAllUsersTemplate = _.template("${apiUrl}/users");
const getPullsTemplate = _.template("${apiUrl}/repos/${org}/${repo}/pulls?page=${page}&per_page=${size}&state=all&base=${head}&sort=updated&direction=desc");
const getPullRequestFilesTemplate = _.template("${apiUrl}/repos/${repo}/pulls/${number}/files");

const modelMap = {
	"comments": Comment,
	"pullRequests": PullRequest
};

const maxSyncDate = moment.utc().startOf("day").subtract(1, "days");
let minSyncDate = moment.utc().startOf("day").subtract(1, "days");

function generateArrayOfDates(fromDate) {
	let dateArray = [];
	let dateToCheck;
	for (dateToCheck = moment.utc(fromDate); dateToCheck.isSameOrBefore(maxSyncDate); dateToCheck.add(1, 'days')) {
		dateArray.push(moment.utc(dateToCheck));
	}
	return dateArray;
}

module.exports = class ContribCat {

	constructor(config) {
		this.config = config;
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
					return UserDetails.findOneAndUpdate({"login": body.login}, body, {"upsert": true}).execAsync().reflect();
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
			var links = linkParser(response.headers.link);
			let items = _.cloneDeep(body);

			if (typeof preProcessor === "function") {
				items = items.filter(preProcessor);
			}

			if (!doNextPage || typeof doNextPage !== "function") {
				doNextPage = function() {
					return true;
				}
			}

			return Promise.map(items, (item) => {
				return this._runPlugins(type, item).then((item) => {
					return modelMap[type].findOneAndUpdate({"url": item.url}, item, {"upsert": true}).execAsync().reflect();
				});
			}).then(() => {
				if (links && links.next && doNextPage(body, items)) {
					return this._fetch(links.next.url, type, preProcessor, doNextPage);
				}
			});
		});
	}

	_loadPullRequests() {
		var query = {"$or": []};
		const preProcessor = function(item) {
			item.base.repo.full_name = item.base.repo.full_name.toLowerCase();
			item.user.login = item.user.login.toLowerCase();
			return moment.utc(item.updated_at).isAfter(minSyncDate);
		}.bind(this);
		let doNextPage = function(originalPrs, filterPrs) {
			return originalPrs.length === filterPrs.length;
		};

		console.log("Fetching pull requests updated since", minSyncDate.toString());

		return Promise.all(this.config.repos.map((target) => {
			var parts = target.split(":");
			var head = parts[1];
			var repo = parts[0];
			var url = getPullsTemplate({
				"apiUrl": this.config.apiUrl,
				"org": repo.split("/")[0],
				"repo": repo.split("/")[1],
				"head": head || this.config.defaultBranch,
				"page": 1,
				"size": this.config.pageSize
			});
			query.$or.push({"base.repo.full_name": repo.toLowerCase()});
			return this._fetch(url, "pullRequests", preProcessor, doNextPage);
		})).then(() => {
			query.updated_at = {$gt: minSyncDate.toDate()};
			return PullRequest.find(query).lean().execAsync();
		});
	}

	_loadPullRequestFiles(prs) {
		console.log("Fetching files for", prs.length, "prs");
		return batch(prs, 15, (prBatch) => {
			return Promise.map(prBatch, (pr) => {
				var url = getPullRequestFilesTemplate({
					"apiUrl": this.config.apiUrl,
					"repo": pr.base.repo.full_name,
					"number": pr.number
				});
				return get(url).then((response) => {
					let files = response[1];
					if (!files) {
						console.log(pr);
					} else {
						pr.files = response[1];
					}

					return this._runPlugins("pullRequests", pr).then((pr) => {
						return PullRequest.findOneAndUpdate({"_id": pr._id}, pr, {"new": true}).execAsync().reflect();
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
				const preProcessor = function(item) {
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

	_createUsers(reportLength, syncDate) {
		let maxDate = moment.utc(syncDate).startOf("day").subtract(reportLength, "days");
		return UserDetails.find().lean().execAsync().then((userDetailsList) => {
			let users = _.keyBy(userDetailsList.map(userDetails => {
				return {
					"name": userDetails.login.toLowerCase(),
					"date": syncDate,
					"duration": reportLength,
					"details": userDetails,
					"repos": []
				}
			}), "name");

			return Comment.find(
				{
					updated_at: {
						$gte: maxDate,
						$lte: syncDate
					}
				},
				{
					"pull_request_url": 1,
					"user.login": 1,
					"filtered": 1,
					"body": 1
				}
			).lean().execAsync().then((comments) => {
				comments = _.groupBy(comments, "pull_request_url");

				return PullRequest.find(
					{
						updated_at: {
							$gte: maxDate,
							$lte: syncDate
						}
					},
					{
						"user.login": 1,
						"filtered": 1,
						"base.repo.full_name": 1,
						"created_at": 1, 
						"url": 1
					}
				).lean().execAsync().map((pr) => {

					var author = pr.user.login;
					var authorRepo = _.find(users[author].repos, {'name': pr.base.repo.full_name});

					if (!authorRepo) {
						authorRepo = {
							"name": pr.base.repo.full_name,
							"prs": [],
							"for": [],
							"against": []
						};
						users[author].repos.push(authorRepo);
					}
					if (moment(pr.created_at).isAfter(maxDate)) {
						if (_.findIndex(authorRepo.prs, function (o) {
								return pr._id.equals(o);
							}) === -1) {
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
								if (_.findIndex(authorRepo.against, function (o) {
										return comment._id.equals(o);
									}) === -1) {
									authorRepo.against.push(comment);
								}

								if (_.findIndex(commenterRepo.for, function (o) {
										return comment._id.equals(o);
									}) === -1) {
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
		return Promise.map(users, (user) => {
			let query = {
				"name": user.name,
				"date": user.date,
				"duration": user.duration
			};
			let options  = {
				"upsert": true,
				"new": true
			};

			return User.findOneAndUpdate(query, user, options).execAsync().reflect();
		});
	}

	_runPlugins(type, result) {
		return Promise.each(this.config.plugins[type], (plugin) => {
			return plugin(result);
		}).then(() => {
			return result;
		});
	}
};
