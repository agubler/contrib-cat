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

module.exports = class ContribCat {

	constructor(config) {
		this.config = config;
		this.getUserTemplate = _.template("${apiUrl}/users/${username}");
		this.getAllUsersTemplate = _.template("${apiUrl}/users");
		this.getPullsTemplate = _.template("${apiUrl}/repos/${org}/${repo}/pulls?page=${page}&per_page=${size}&state=all&base=${head}&sort=updated&direction=desc");
		this.getPullRequestFilesTemplate = _.template("${apiUrl}/repos/${repo}/pulls/${number}/files");
		this.cutOffDate = moment.utc().startOf("day").subtract(this.config.syncDays, "days");
		this.modelMap = {
			"comments": Comment,
			"pullRequests": PullRequest
		};
		mongoose.connect(connectionTemplate(this.config.store), { keepAlive: 120 });
	}

	load() {
		return this.getPullRequestsForRepos(this.config)
			.then(this.getPullRequestFiles.bind(this))
			.then(this.getCommentsForPullRequests.bind(this, "comment"))
			.then(this.getCommentsForPullRequests.bind(this, "issue"));
	}

	sync(startDate) {
		if (!startDate) {
			startDate = moment.utc().startOf("days").toDate();
		}
		console.log("Starting sync for", startDate);
		return this.fetchUsers().then(() => {
			return Promise.map(this.config.reportDays, (days) => {
				return this.createUsers(days, startDate)
					.then(this.runPlugins.bind(this, "users"))
					.then(this.saveUsers.bind(this));
			});
		});
	}

	fetchUsers(url) {
		if (!this.usersFetched) {
			if (!url) {
				console.log("Fetching user details");
				url = this.getAllUsersTemplate({"apiUrl": this.config.apiUrl});
			}
			return get(url).spread((response, body) => {
				let links = linkParser(response.headers.link);

				return Promise.map(body, (userDetails) => {
					userDetails.login = userDetails.login.toLowerCase();
					return get(this.getUserTemplate({
						"apiUrl": this.config.apiUrl,
						"username": userDetails.login
					})).spread((response, body) => {
						return UserDetails.findOneAndUpdate({"login": body.login}, body, {"upsert": true}).execAsync().reflect();
					});
				}).then(() => {
					if (links && links.next) {
						return this.fetchUsers(links.next.url);
					} else {
						this.usersFetched = true;
						console.log("Fetching user details completed");
					}
				});
			});
		} else {
			console.log("user details cached");
			return Promise.resolve();
		}
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
				return this.runPlugins(type, item).then((item) => {
					return this.modelMap[type].findOneAndUpdate({"url": item.url}, item, {"upsert": true}).execAsync().reflect();
				});
			}).then(() => {
				if (links && links.next && doNextPage(body, items)) {
					return this._fetch(links.next.url, type, preProcessor, doNextPage);
				}
			});
		});
	}

	getPullRequestsForRepos() {
		var query = {"$or": []};
		const preProcessor = function(item) {
			item.base.repo.full_name = item.base.repo.full_name.toLowerCase();
			item.user.login = item.user.login.toLowerCase();
			return moment.utc(item.updated_at).isAfter(this.cutOffDate);
		}.bind(this);
		let doNextPage = function(originalPrs, filterPrs) {
			return originalPrs.length === filterPrs.length;
		};

		console.log("fetching pull requests updated since ", this.cutOffDate.toString());

		return Promise.all(this.config.repos.map((target) => {
			var parts = target.split(":");
			var head = parts[1];
			var repo = parts[0];
			var url = this.getPullsTemplate({
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
			query.updated_at = {$gt: this.cutOffDate.toDate()};
			return PullRequest.find(query).lean().execAsync();
		});
	}

	getPullRequestFiles(prs) {
		console.log("fetching files for", prs.length, "prs");
		return batch(prs, 15, (prBatch) => {
			return Promise.map(prBatch, (pr) => {
				var url = this.getPullRequestFilesTemplate({
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

					return this.runPlugins("pullRequests", pr).then((pr) => {
						return PullRequest.findOneAndUpdate({"_id": pr._id}, pr, {"new": true}).execAsync().reflect();
					});
				});
			}).then(() => {
				return prs;
			});
		})
	};

	getCommentsForPullRequests(type, prs) {
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

	createUsers(reportLength, startDate) {
		let maxDate = moment.utc(startDate).startOf("day").subtract(reportLength, "days");
		return UserDetails.find().lean().execAsync().then((userDetailsList) => {
			let users = _.keyBy(userDetailsList.map(userDetails => {
				return {
					"name": userDetails.login.toLowerCase(),
					"date": startDate,
					"duration": reportLength,
					"details": userDetails,
					"repos": []
				}
			}), "name");

			return Comment.find(
				{
					updated_at: {
						$gte: maxDate,
						$lte: startDate
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
							$lte: startDate
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

	saveUsers(users) {
		return Promise.map(users, (user) => {
			return User.findOneAndUpdate({"name": user.name, "date": user.date, "duration": user.duration}, user, {"upsert": true, "new": true}).execAsync().reflect();
		}).then(() => {
			return users;
		});
	}

	runPlugins(type, result) {
		return Promise.each(this.config.plugins[type], (plugin) => {
			return plugin(result);
		}).then(() => {
			return result;
		});
	}
};
