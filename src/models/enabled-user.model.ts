import mongoose, { Schema, Document } from "mongoose";

export interface IEnabledUser extends Document {
  email: string;
  linearUserId: string | null;
  slackUserId: string | null;
  enabled: boolean;
  createdAt: Date;
}

const EnabledUserSchema = new Schema<IEnabledUser>({
  email: { type: String, required: true, unique: true, lowercase: true },
  linearUserId: { type: String, default: null },
  slackUserId: { type: String, default: null },
  enabled: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

export const EnabledUser = mongoose.model<IEnabledUser>(
  "EnabledUser",
  EnabledUserSchema
);

