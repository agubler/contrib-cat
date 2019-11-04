import { ReportUser } from '../interfaces';

interface Options {
	pr: number;
	for: number;
	against: number;
	sentiment: number;
}

export default function(options: Options) {
	return (users: ReportUser[]): ReportUser[] => {
		return users.map((user) => {
			const prScore = user.prs.length * options.pr;
			const forScore = user.for.length * options.for;
			console.log(user.for);
			const againstScore = user.against.length * options.against;
			user.kudos = prScore + forScore + againstScore;
			return user;
		});
	};
}
