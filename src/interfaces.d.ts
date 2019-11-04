import { User } from './models/User';

export interface Repository {
	owner: string;
	repo: string;
}

export interface Connection {
	host: string;
	db: string;
}

export interface ReportUser extends User {
	kudos?: number;
}

export interface Plugin {
	(users: ReportUser[]): ReportUser[];
}

export interface Config {
	api?: string;
	auth?: string;
	connection: Connection;
	repositories: Repository[];
	plugins?: Plugin[];
	syncDays: number;
}
