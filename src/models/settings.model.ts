import mongoose, { Schema, Document } from "mongoose";

export interface ISettings extends Document {
  key: string;
  value: string;
  updatedAt: Date;
}

const SettingsSchema = new Schema<ISettings>({
  key: { type: String, required: true, unique: true },
  value: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now },
});

export const Settings = mongoose.model<ISettings>("Settings", SettingsSchema);

// Helper functions
export async function getSetting(key: string, defaultValue: string): Promise<string> {
  const setting = await Settings.findOne({ key });
  return setting?.value ?? defaultValue;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await Settings.findOneAndUpdate(
    { key },
    { key, value, updatedAt: new Date() },
    { upsert: true }
  );
}

