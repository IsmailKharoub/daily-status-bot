import mongoose, { Schema, Document } from "mongoose";

export interface IUserMapping extends Document {
  linearUserId: string;
  slackUserId: string;
  email: string;
  lastUpdated: Date;
}

const UserMappingSchema = new Schema<IUserMapping>({
  linearUserId: { type: String, required: true, unique: true },
  slackUserId: { type: String, required: true, index: true },
  email: { type: String, required: true },
  lastUpdated: { type: Date, default: Date.now },
});

export const UserMapping = mongoose.model<IUserMapping>(
  "UserMapping",
  UserMappingSchema
);

