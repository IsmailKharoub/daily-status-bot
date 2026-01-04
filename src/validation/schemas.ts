import { z } from "zod";

export const authSchema = z.object({
  code: z.string().length(6, "Code must be 6 digits").regex(/^\d+$/, "Code must be numeric"),
});

export const addUserSchema = z.object({
  email: z.string().email("Invalid email address").toLowerCase(),
});

export const scheduleSchema = z.object({
  cronSchedule: z.string().min(9, "Invalid cron expression"),
  timezone: z.string().min(1, "Timezone is required"),
});

export const settingsSchema = z.object({
  channelId: z.string().min(1, "Channel ID is required").startsWith("C", "Channel ID must start with C"),
});

export const triggerUserSchema = z.object({
  email: z.string().email().toLowerCase(),
});

// Slack interaction payload schema
export const slackInteractionPayloadSchema = z.object({
  type: z.string(),
  user: z.object({ id: z.string() }),
  channel: z.object({ id: z.string() }),
  message: z.object({ ts: z.string() }),
  actions: z.array(z.object({
    action_id: z.string(),
    selected_options: z.array(z.object({ value: z.string() })).optional(),
    value: z.string().optional(),
  })),
});

// Submit with notes schema (for future modal submissions)
export const submitWithNotesSchema = z.object({
  ticketIds: z.array(z.string()),
  notes: z.string().optional(),
  blockers: z.string().optional(),
});

export type AuthInput = z.infer<typeof authSchema>;
export type AddUserInput = z.infer<typeof addUserSchema>;
export type ScheduleInput = z.infer<typeof scheduleSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type SlackInteractionPayload = z.infer<typeof slackInteractionPayloadSchema>;
export type SubmitWithNotesInput = z.infer<typeof submitWithNotesSchema>;

