import cron, { ScheduledTask } from "node-cron";
import { env } from "../config/env";
import { getSetting, setSetting } from "../models";
import {
  userService,
  linearService,
  slackService,
  historyService,
} from "../services";

let currentTask: ScheduledTask | null = null;

async function sendDailyPrompts(): Promise<void> {
  console.log("Starting daily status collection...");

  try {
    const userMapping = await userService.getEnabledUsers();
    console.log(`Processing ${userMapping.size} enabled users...`);

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
          console.log(
            `Sent daily prompt to ${slackUserId} with ${tickets.length} tickets`
          );
        } else {
          await slackService.sendNoTicketsMessage(slackUserId);
          console.log(`Sent no-tickets message to ${slackUserId}`);
        }
      } catch (error) {
        console.error(`Failed to process user ${linearUserId}:`, error);
      }
    }

    console.log("Daily status collection complete");
  } catch (error) {
    console.error("Failed to run daily prompts:", error);
  }
}

export async function getScheduleSettings(): Promise<{
  cronSchedule: string;
  timezone: string;
  nextRun: string | null;
}> {
  const cronSchedule = await getSetting("cronSchedule", env.cronSchedule);
  const timezone = await getSetting("timezone", "UTC");
  
  // Calculate next run time
  let nextRun: string | null = null;
  try {
    nextRun = getNextCronRun(cronSchedule, timezone);
  } catch {
    nextRun = null;
  }

  return { cronSchedule, timezone, nextRun };
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
  // Parse cron and calculate next run
  const parts = cronExpression.split(" ");
  if (parts.length !== 5) return "Invalid cron";

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  
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

  // Simple next run calculation for common patterns
  const nowInTz = new Date(formatter.format(now));
  const targetHour = hour === "*" ? nowInTz.getHours() : parseInt(hour);
  const targetMinute = minute === "*" ? 0 : parseInt(minute);

  let nextRun = new Date(nowInTz);
  nextRun.setHours(targetHour, targetMinute, 0, 0);

  // If time has passed today, move to next valid day
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

async function restartScheduler(): Promise<void> {
  // Stop existing task
  if (currentTask) {
    currentTask.stop();
    console.log("Stopped existing scheduler");
  }

  // Start new task with updated settings
  const { cronSchedule, timezone } = await getScheduleSettings();
  
  console.log(`Starting scheduler: ${cronSchedule} (${timezone})`);
  
  currentTask = cron.schedule(cronSchedule, sendDailyPrompts, {
    timezone,
  });
}

export async function startScheduler(): Promise<void> {
  await restartScheduler();
  const { cronSchedule, timezone, nextRun } = await getScheduleSettings();
  console.log(`Scheduler started: ${cronSchedule} (${timezone})`);
  console.log(`Next run: ${nextRun}`);
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

// Export for manual triggering
export { sendDailyPrompts };
