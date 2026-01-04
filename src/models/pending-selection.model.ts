import mongoose, { Schema, Document } from "mongoose";

export interface IPendingSelection extends Document {
  slackUserId: string;
  selectedTicketIds: string[];
  messageTs: string;
  createdAt: Date;
  expiresAt: Date;
}

const PendingSelectionSchema = new Schema<IPendingSelection>({
  slackUserId: { type: String, required: true, index: true },
  selectedTicketIds: { type: [String], default: [] },
  messageTs: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, index: true },
});

// TTL index for auto-cleanup
PendingSelectionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PendingSelection = mongoose.model<IPendingSelection>(
  "PendingSelection",
  PendingSelectionSchema
);

