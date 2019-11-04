import mongoose, { Schema, Document } from 'mongoose';
import PullRequest from './PullRequest';

export interface User extends Document {
	login: string;
	prs: PullRequest[];
	against: Comment[];
	for: Comment[];
}

const userScheme = new Schema({
	login: { type: String, unique: true, required: true },
	prs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PullRequest' }],
	against: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Comment' }],
	for: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Comment' }]
});

export const User = mongoose.model<User>('User', userScheme);
