import mongoose, { Schema, Document } from 'mongoose';

export interface PullRequest extends Document {
	url: string;
	id: number;
	owner: string;
	repo: string;
	html_url: string;
	diff_url: string;
	patch_url: string;
	issue_url: string;
	number: number;
	state: string;
	locked: boolean;
	title: string;
	user: {
		login: string;
		id: number;
		avatar_url: string;
		url: string;
		html_url: string;
	};
	body: string;
	created_at: string;
	updated_at: string;
	closed_at: string;
	merged_at: string;
	milestone: string;
	commits_url: string;
	review_comments_url: string;
	review_comment_url: string;
	comments_url: string;
	statuses_url: string;
	merged: boolean;
	mergeable: boolean;
	mergeable_state: string;
	merged_by: string;
	comments: number;
	review_comments: number;
	commits: number;
	additions: number;
	deletions: number;
	changed_files: number;
}

var schema = new Schema({
	url: { type: String, unique: true, required: true },
	id: Number,
	repo: String,
	html_url: String,
	diff_url: String,
	patch_url: String,
	issue_url: String,
	number: Number,
	state: String,
	locked: Boolean,
	title: String,
	user: {
		login: { type: String, lowercase: true },
		id: Number,
		avatar_url: String,
		url: String,
		html_url: String
	},
	body: String,
	created_at: Date,
	updated_at: Date,
	closed_at: Date,
	merged_at: Date,
	milestone: String,
	commits_url: String,
	review_comments_url: String,
	review_comment_url: String,
	comments_url: String,
	statuses_url: String,
	merged: Boolean,
	mergeable: Boolean,
	mergeable_state: String,
	merged_by: String,
	comments: Number,
	review_comments: Number,
	commits: Number,
	additions: Number,
	deletions: Number,
	changed_files: Number
});

export const PullRequest = mongoose.model<PullRequest>('PullRequest', schema);

export default PullRequest;
