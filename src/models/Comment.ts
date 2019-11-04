import mongoose, { Schema, Document } from 'mongoose';

export interface Comment extends Document {
	url: string;
	pull_request_url: string;
	html_url: string;
	id: number;
	repo: string;
	user: {
		login: string;
		avatar_url: string;
	};
	position: number;
	line: number;
	filtered: boolean;
	path: string;
	commit_id: string;
	created_at: string;
	updated_at: string;
	body: string;
}

const schema = new Schema({
	url: { type: String, unique: true, required: true },
	pull_request_url: String,
	html_url: String,
	id: Number,
	repo: String,
	user: {
		login: { type: String, lowercase: true },
		avatar_url: String
	},
	position: Number,
	line: Number,
	filtered: Boolean,
	path: String,
	commit_id: String,
	created_at: Date,
	updated_at: Date,
	body: String
});

export const Comment = mongoose.model<Comment>('Comment', schema);

export default Comment;
