"use strict";

var request = require("request");
var moment = require("moment");
var Promise = require('bluebird');
var _ = require("lodash");
var linkParser = require('parse-link-header');
var mongoose = require('mongoose');
var _get = Promise.promisify(request.get, {multiArgs: true});
var get = require("./cache")(_get);
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
		this.cutOffDate = moment().startOf("day").subtract(this.config.syncDays, "days");
		mongoose.connect(connectionTemplate(this.config.store), { keepAlive: 120 });
	}

	load() {
		if (this.config.caching) {
			get.load();
		}

		var results = this.getPullRequestsForRepos(this.config)
			.then(this.getPullRequestFiles.bind(this))
			.then(this.getCommentsOnCodeForPullRequestsBatch.bind(this))
			.then(this.getCommentsOnIssueForPullRequestsBatch.bind(this));

		if (this.config.caching) {
			results.then(get.dump);
		}
		return results;
	}

	sync(startDate) {
		if (!startDate) {
			startDate = moment().startOf("days").toDate();
		}

		return this.fetchUsers().then(() => {
				return Promise.map(this.config.reportDays, (days) => {
					return this.createUsers(days, startDate)
						.then(this.runPluginsForSync.bind(this))
						.then(this.saveUsers.bind(this))
						.then(this.saveComments.bind(this))
						.then(this.savePrs.bind(this));
				});
			});
	}

	fetchUsers(url) {
		if (!url) {
			url = this.getAllUsersTemplate({"apiUrl": this.config.apiUrl});
		}
		return get(url, "users").spread((response, body) => {
			let links = linkParser(response.headers.link);

			return Promise.map(body, (userDetails) => {
				userDetails.login = userDetails.login.toLowerCase();
				return get(this.getUserTemplate({"apiUrl": this.config.apiUrl, "username": userDetails.login}), "users").spread((response, body) => {
					return UserDetails.findOneAndUpdate({"login": body.login}, body, {"upsert": true}).execAsync().reflect();
				});
			}).then(() => {
				if (links && links.next) {
					return this.fetchUsers(links.next.url);
				}
			});
		});
	}

	_fetchPullRequests(url, repo) {
		return get(url, repo).spread((response, body) => {
			body = _.cloneDeep(body);
			var links = linkParser(response.headers.link);

			var items = body.filter((item) => {
				return moment(item.updated_at).isAfter(this.cutOffDate);
			});

			return Promise.map(items, (item) => {
				item.base.repo.full_name = item.base.repo.full_name.toLowerCase();
				item.user.login = item.user.login.toLowerCase();
				item.comments = [];
				return PullRequest.findOneAndUpdate({"url": item.url}, item, {"upsert": true}).execAsync().reflect();
			}).then(() => {
				if (links && links.next && items.length === body.length) {
					return this._fetchPullRequests(links.next.url, repo);
				}
			});
		});
	}

	_fetchCommentsForPullRequest(url, pr_url, repo) {
		return get(url, repo).spread((response, body) => {
			var links = linkParser(response.headers.link);

			body = _.cloneDeep(body);
			body.forEach((comment) => {
				comment.user.login = comment.user.login.toLowerCase();
				if (!comment.pull_request_url) {
					comment.pull_request_url = pr_url;
				}
			});

			return Promise.map(body, (item) => {
				return Comment.createAsync(item).reflect();
			}).then(() => {
				if (links && links.next) {
					return this._fetchCommentsForPullRequest(links.next.url, pr_url, repo);
				}
			});
		});
	}

	getPullRequestsForRepos() {
		var query = {"$or": []};
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
			return this._fetchPullRequests(url, repo);
		})).then(() => {
			query.updated_at = {$gt: this.cutOffDate.toDate()};
			return PullRequest.find(query).lean().execAsync();
		});
	}

	getPullRequestFiles(prs) {
		return batch(prs, 15, (prBatch) => {
			return Promise.map(prBatch, (pr) => {
				var url = this.getPullRequestFilesTemplate({
					"apiUrl": this.config.apiUrl,
					"repo": pr.base.repo.full_name,
					"number": pr.number
				});
				return _get({uri: url, json: true}).then((response) => {
					let files = response[1];
					if (!files) {
						console.log(pr);
					} else {
						pr.files = response[1];
					}

					return PullRequest.findOneAndUpdate({"_id": pr._id}, pr, {"new": true}).execAsync().reflect();
				});
			}).then(() => {
				return prs;
			});
		})
	};

	getCommentsOnCodeForPullRequests(prs) {
		return Promise.map(prs, (pr) => {
			return this._fetchCommentsForPullRequest(pr.review_comments_url, pr.url, pr.base.repo.full_name);
		}).then(() => {
			return prs;
		});
	}

	getCommentsOnCodeForPullRequestsBatch(prs) {
		var chunkedArray = _.chunk(prs, 10);
		var first = chunkedArray.shift();

		var finish = chunkedArray.reduce((defPrevious, current, currentIndex) => {
			return defPrevious.then(() => {
				console.log("Processing Pull Requests Comments batch", currentIndex + 1, "of", chunkedArray.length);
				return this.getCommentsOnCodeForPullRequests(current);
			});
		}, this.getCommentsOnCodeForPullRequests(first));

		return finish.then(() => {
			return prs;
		});
	}

	getCommentsOnIssueForPullRequests(prs) {
		return Promise.map(prs, (pr) => {
			return this._fetchCommentsForPullRequest(pr.comments_url, pr.url, pr.base.repo.full_name)
		}).then(() => {
			return prs;
		});
	}

	getCommentsOnIssueForPullRequestsBatch(prs) {
		var chunkedArray = _.chunk(prs, 10);
		var first = chunkedArray.shift();

		var finish = chunkedArray.reduce((defPrevious, current, currentIndex) => {
			return defPrevious.then(() => {
				console.log("Processing Issue Comments batch", currentIndex + 1, "of", chunkedArray.length);
				return this.getCommentsOnIssueForPullRequests(current);
			});
		}, this.getCommentsOnIssueForPullRequests(first));

		return finish.then(() => {
			return prs;
		});
	}

	createUsers(reportLength, startDate) {
		let maxDate = moment(startDate).startOf("day").subtract(reportLength, "days");
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
						"base.repo.full_name": 1,
						"created_at": 1, "url": 1
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

	runPluginsForSync(results) {
		return this.runPlugins(results).then(result => {
			return result;
		});
	}

	saveUsers(users) {
		return Promise.map(users, (user) => {
			return User.findOneAndUpdate({"name": user.name, "date": user.date, "duration": user.duration}, user, {"upsert": true, "new": true}).execAsync().reflect();
		}).then(() => {
			return users;
		});
	}

	saveComments(users) {
		return Promise.map(users, (user) => {
			return Promise.map(user.repos, (repo) => {
				return Promise.map(repo.for, (comment) => {
					return Comment.findOneAndUpdate({"_id": comment._id}, comment, {"new": true}).execAsync().reflect();
				}).then(() => {
					return Promise.map(repo.against, (comment) => {
						return Comment.findOneAndUpdate({"_id": comment._id}, comment, {"new": true}).execAsync().reflect();
					});
				});
			});
		}).then(() => {
			return users;
		});
	}

	savePrs(users) {
		return Promise.map(users, (user) => {
			return Promise.map(user.repos, (repo) => {
				return Promise.map(repo.prs, (pr) => {
					return PullRequest.findOneAndUpdate({"_id": pr._id}, pr, {"new": true}).execAsync().reflect();
				});
			});
		}).then(() => {
			return users;
		});
	}

	runPlugins(result) {
		return Promise.each(this.config.plugins, (plugin) => {
			return plugin(result);
		}).then(() => {
			return result;
		});
	}

	runReporters(result) {
		return Promise.each(this.config.reporters, (reporter) => {
			return reporter(result);
		}).then(() => {
			return result;
		});
	}
};
