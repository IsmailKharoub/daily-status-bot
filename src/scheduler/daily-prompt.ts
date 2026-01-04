import cron, { ScheduledTask } from "node-cron";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { getSetting, setSetting, EnabledUser } from "../models";
import {
  userService,
  linearService,
  slackService,
  historyService,
} from "../services";

let dailyTask: ScheduledTask | null = null;
let reminderTask: ScheduledTask | null = null;

async function sendDailyPrompts(): Promise<void> {
  logger.info("Starting daily status collection...");

  try {
    const userMapping = await userService.getEnabledUsers();
    logger.info({ userCount: userMapping.size }, "Processing enabled users");

    for (const [linearUserId, slackUserId] of userMapping) {
      try {
        const [tickets, yesterdayStatus] = await Promise.all([
          linearService.getIncompleteTicketsForUser(linearUserId),
          historyService.getYesterdayStatus(slackUserId),
        ]);

        if (tickets.length > 0) {
          await slackService.sendTicketSelectionDM(
            slackUserId,
            tickets,
            yesterdayStatus
          );
          logger.info({ slackUserId, ticketCount: tickets.length }, "Sent daily prompt");
        } else {
          await slackService.sendNoTicketsMessage(slackUserId);
          logger.info({ slackUserId }, "Sent no-tickets message");
        }
      } catch (error) {
        logger.error({ error, linearUserId }, "Failed to process user");
      }
    }

    logger.info("Daily status collection complete");
  } catch (error) {
    logger.error({ error }, "Failed to run daily prompts");
  }
}

async function sendReminders(): Promise<void> {
  logger.info("Checking for pending submissions...");

  try {
    const enabledUsers = await EnabledUser.find({ 
      enabled: true,
      slackUserId: { $ne: null },
    });
    
    const slackUserIds = enabledUsers
      .filter((u) => u.slackUserId)
      .map((u) => u.slackUserId!);

    const pendingUserIds = await historyService.getPendingUsers(slackUserIds);
    
    logger.info({ pendingCount: pendingUserIds.length }, "Found pending users");

    for (const slackUserId of pendingUserIds) {
      try {
        await slackService.sendReminder(slackUserId);
      } catch (error) {
        logger.error({ error, slackUserId }, "Failed to send reminder");
      }
    }
  } catch (error) {
    logger.error({ error }, "Failed to send reminders");
  }
}

export async function getScheduleSettings(): Promise<{
  cronSchedule: string;
  timezone: string;
  nextRun: string | null;
  reminderEnabled: boolean;
}> {
  const cronSchedule = await getSetting("cronSchedule", env.cronSchedule);
  const timezone = await getSetting("timezone", "UTC");
  const reminderEnabled = (await getSetting("reminderEnabled", "true")) === "true";
  
  let nextRun: string | null = null;
  try {
    nextRun = getNextCronRun(cronSchedule, timezone);
  } catch {
    nextRun = null;
  }

  return { cronSchedule, timezone, nextRun, reminderEnabled };
}

export async function updateSchedule(
  cronSchedule: string,
  timezone: string
): Promise<{ success: boolean; error?: string }> {
  // Validate cron expression
  if (!cron.validate(cronSchedule)) {
    return { success: false, error: "Invalid cron expression" };
  }

  // Validate timezone
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    return { success: false, error: "Invalid timezone" };
  }

  // Save to database
  await setSetting("cronSchedule", cronSchedule);
  await setSetting("timezone", timezone);

  // Restart the scheduler with new settings
  await restartScheduler();

  return { success: true };
}

function getNextCronRun(cronExpression: string, timezone: string): string {
  const parts = cronExpression.split(" ");
  if (parts.length !== 5) return "Invalid cron";

  const [minute, hour, , , dayOfWeek] = parts;
  
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const nowInTz = new Date(formatter.format(now));
  const targetHour = hour === "*" ? nowInTz.getHours() : parseInt(hour);
  const targetMinute = minute === "*" ? 0 : parseInt(minute);

  const nextRun = new Date(nowInTz);
  nextRun.setHours(targetHour, targetMinute, 0, 0);

  if (nextRun <= nowInTz) {
    nextRun.setDate(nextRun.getDate() + 1);
  }

  // Skip weekends if dayOfWeek is 1-5 (Mon-Fri)
  if (dayOfWeek === "1-5") {
    while (nextRun.getDay() === 0 || nextRun.getDay() === 6) {
      nextRun.setDate(nextRun.getDate() + 1);
    }
  }

  return nextRun.toLocaleString("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function calculateReminderCron(dailyCron: string, delayHours: number): string {
  const parts = dailyCron.split(" ");
  if (parts.length !== 5) return dailyCron;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  
  if (hour === "*") return dailyCron;
  
  const reminderHour = (parseInt(hour) + delayHours) % 24;
  return `${minute} ${reminderHour} ${dayOfMonth} ${month} ${dayOfWeek}`;
}

async function restartScheduler(): Promise<void> {
  // Stop existing tasks
  if (dailyTask) {
    dailyTask.stop();
    logger.info("Stopped daily scheduler");
  }
  if (reminderTask) {
    reminderTask.stop();
    logger.info("Stopped reminder scheduler");
  }

  const { cronSchedule, timezone, reminderEnabled } = await getScheduleSettings();
  
  // Start daily prompts task
  logger.info({ cronSchedule, timezone }, "Starting daily scheduler");
  dailyTask = cron.schedule(cronSchedule, sendDailyPrompts, { timezone });

  // Start reminder task (X hours after daily prompts)
  if (reminderEnabled) {
    const reminderCron = calculateReminderCron(cronSchedule, env.reminderDelayHours);
    logger.info({ reminderCron, timezone }, "Starting reminder scheduler");
    reminderTask = cron.schedule(reminderCron, sendReminders, { timezone });
  }
}

export async function startScheduler(): Promise<void> {
  await restartScheduler();
  const { cronSchedule, timezone, nextRun } = await getScheduleSettings();
  logger.info({ cronSchedule, timezone, nextRun }, "Scheduler started");
}

export function stopScheduler(): void {
  if (dailyTask) {
    dailyTask.stop();
    dailyTask = null;
  }
  if (reminderTask) {
    reminderTask.stop();
    reminderTask = null;
  }
  logger.info("Scheduler stopped");
}

// Send daily prompt to a specific user by email
async function sendDailyPromptForUser(email: string): Promise<{ success: boolean; message: string }> {
  try {
    const mapping = await userService.getUserMappingByEmail(email);
    
    if (!mapping) {
      return { success: false, message: `No mapping found for ${email}` };
    }

    const [tickets, yesterdayStatus] = await Promise.all([
      linearService.getIncompleteTicketsForUser(mapping.linearUserId),
      historyService.getYesterdayStatus(mapping.slackUserId),
    ]);

    if (tickets.length > 0) {
      await slackService.sendTicketSelectionDM(
        mapping.slackUserId,
        tickets,
        yesterdayStatus
      );
      return { success: true, message: `Sent ${tickets.length} tickets to ${email}` };
    } else {
      await slackService.sendNoTicketsMessage(mapping.slackUserId);
      return { success: true, message: `Sent no-tickets message to ${email}` };
    }
  } catch (error) {
    logger.error({ error, email }, "Failed to trigger for user");
    return { success: false, message: String(error) };
  }
}

// Common timezones for the UI
export const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Jerusalem",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export { sendDailyPrompts, sendDailyPromptForUser };
