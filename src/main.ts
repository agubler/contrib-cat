import mongoose from 'mongoose';
import moment from 'moment';
import * as _ from 'lodash';
import Github from '@octokit/rest';
const { performance } = require('perf_hooks');

import { Config, ReportUser } from './interfaces';
import { User } from './models/User';
import { PullRequest } from './models/PullRequest';
import { Comment } from './models/Comment';

const FIND_UPDATE_OPTIONS = {
	upsert: true,
	new: true
};

function calculateDays(start: string, end: string) {
	let startDate = moment(new Date(start)).startOf('day');
	let endDate = moment(new Date(end)).startOf('day');
	let dates = [];
	while (!startDate.isAfter(endDate)) {
		dates.push(startDate.toDate().getTime());
		startDate = startDate.add(1, 'day').startOf('day');
	}
	return dates;
}

async function connect(host: string, db: string) {
	await mongoose.connect(`mongodb://${host}/${db}`, {
		useNewUrlParser: true,
		useUnifiedTopology: true,
		useFindAndModify: false
	});
	mongoose.set('useCreateIndex', true);
}

function contribCat(config: Config) {
	const {
		connection: { host, db },
		syncDays,
		plugins = [],
		auth
	} = config;

	const gh = new Github({
		auth
	});
	const syncDate = moment()
		.startOf('day')
		.subtract(syncDays, 'day');

	async function loadPullRequests(owner: string, repo: string, initial = false) {
		const options = gh.pulls.list.endpoint.merge({
			owner,
			repo,
			sort: 'updated',
			state: 'all',
			direction: 'desc'
		});
		const pullRequests: Github.PullsGetResponse[] = [];
		for await (const response of gh.paginate.iterator(options)) {
			pullRequests.push(...response.data);
			response.data.some((pr: Github.PullsGetResponse) => {
				return moment(pr.updated_at).isBefore(syncDate);
			});
			if (
				!initial &&
				response.data.some((pr: Github.PullsGetResponse) => moment(pr.updated_at).isBefore(syncDate))
			) {
				break;
			}
		}
		return pullRequests;
	}

	async function loadComments(
		owner: string,
		repo: string,
		pullRequestNumber: number
	): Promise<Github.PullsListCommentsResponseItem[]> {
		const commentOptions = gh.pulls.listComments.endpoint.merge({
			owner,
			repo,
			pull_number: pullRequestNumber
		});
		const issueCommentOptions = gh.issues.listComments.endpoint.merge({
			owner,
			repo,
			issue_number: pullRequestNumber
		});
		const comments = await gh.paginate(commentOptions);
		const issueComments = await gh.paginate(issueCommentOptions);
		return [...comments, ...issueComments];
	}

	function savePullRequests(prs: any[], owner: string, repo: string) {
		const promises = prs.map((pr) =>
			PullRequest.findOneAndUpdate({ url: pr.url }, { ...pr, repo: `${owner}/${repo}` }, FIND_UPDATE_OPTIONS)
				.lean()
				.exec()
		);
		return Promise.all(promises);
	}

	function saveUsers(users: { [index: string]: User }) {
		const usernames = Object.keys(users);
		const promises = usernames.map((username) => users[username].save());
		return Promise.all(promises);
	}

	function saveComments(comments: any[], owner: string, repo: string) {
		const promises = comments.map((comment) =>
			Comment.findOneAndUpdate(
				{ url: comment.url },
				{ ...comment, repo: `${owner}/${repo}` },
				FIND_UPDATE_OPTIONS
			)
				.lean()
				.exec()
		);
		return Promise.all(promises);
	}

	async function load(owner: string, repo: string, initial = false) {
		const prs = await loadPullRequests(owner, repo, initial);
		const savedPullRequests = await savePullRequests(prs, owner, repo);
		const usersToSave: { [index: string]: User } = {};
		for (const pr of savedPullRequests) {
			if (!usersToSave[pr.user.login]) {
				usersToSave[pr.user.login] = (await User.findOneAndUpdate(
					{ login: pr.user.login },
					pr.user,
					FIND_UPDATE_OPTIONS
				)) as User;
			}
			const author = usersToSave[pr.user.login];
			if (!author.prs.includes(pr._id)) {
				author.prs.push(pr._id);
			}

			const comments = await loadComments(owner, repo, pr.number);
			const savedComments = await saveComments(comments, owner, repo);
			for (const comment of savedComments) {
				if (!usersToSave[comment.user.login]) {
					usersToSave[comment.user.login] = (await User.findOneAndUpdate(
						{ login: comment.user.login },
						comment.user,
						FIND_UPDATE_OPTIONS
					)) as User;
				}
				const commentAuthor = usersToSave[comment.user.login];
				if (comment.user.login !== author.login) {
					if (!author.against.includes(comment._id)) {
						author.against.push(comment._id);
					}
					if (!commentAuthor.for.includes(comment._id)) {
						commentAuthor.for.push(comment._id);
					}
				}
			}
		}
		await saveUsers(usersToSave);
	}

	return {
		load: async (initial = false) => {
			await connect(
				host,
				db
			);
			for (const repo of config.repositories) {
				await load(repo.owner, repo.repo, initial);
			}
			await mongoose.disconnect();
		},
		report: async () => {
			const start = performance.now();
			await connect(
				host,
				db
			);
			const reportStartDate = moment()
				.startOf('day')
				.subtract(500, 'day');
			const match = { created_at: { $gt: reportStartDate.toDate() }, repo: { $in: ['SitePen/securus-sow10'] } };
			let users: ReportUser[] = await User.find({})
				.populate({
					path: 'prs',
					match: { ...match, merged_at: { $ne: null } }
				})
				.populate({
					path: 'against',
					match
				})
				.populate({
					path: 'for',
					match
				})
				.lean()
				.exec();

			console.log('took', performance.now() - start);
			// run plugins
			for (let i = 0; i < plugins.length; i++) {
				const plugin = plugins[i];
				users = plugin(users);
			}

			users.forEach((user) => {
				// let days: any[] = [];
				// for (let i = 0; i < user.prs.length; i++) {
				// 	const pr = user.prs[i];
				// 	if (pr.closed_at) {
				// 		days = [...days, ...calculateDays(pr.created_at, pr.closed_at)];
				// 	}
				// }
				console.log(user.login, 'KUDOS', user.kudos);
			});
			await mongoose.disconnect();
			const end = performance.now();
			console.log('took', end - start);
			return users;
		}
	};
}

export default contribCat;
