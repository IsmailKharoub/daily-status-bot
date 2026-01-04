import mongoose, { Schema, Document } from "mongoose";

export interface ISelectedTicket {
  ticketId: string;
  identifier: string;
  title: string;
  url: string;
}

export interface IDailyStatus extends Document {
  slackUserId: string;
  linearUserId: string;
  date: Date;
  selectedTickets: ISelectedTicket[];
  submittedAt: Date;
}

const SelectedTicketSchema = new Schema<ISelectedTicket>(
  {
    ticketId: { type: String, required: true },
    identifier: { type: String, required: true },
    title: { type: String, required: true },
    url: { type: String, required: true },
  },
  { _id: false }
);

const DailyStatusSchema = new Schema<IDailyStatus>({
  slackUserId: { type: String, required: true, index: true },
  linearUserId: { type: String, required: true, index: true },
  date: { type: Date, required: true, index: true },
  selectedTickets: { type: [SelectedTicketSchema], default: [] },
  submittedAt: { type: Date, default: Date.now },
});

// Compound index for querying user's status by date
DailyStatusSchema.index({ slackUserId: 1, date: 1 }, { unique: true });

export const DailyStatus = mongoose.model<IDailyStatus>(
  "DailyStatus",
  DailyStatusSchema
);

