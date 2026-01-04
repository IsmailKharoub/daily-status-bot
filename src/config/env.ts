function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

export const env = {
  get linearApiKey() {
    return requireEnv("LINEAR_API_KEY");
  },
  get slackBotToken() {
    return requireEnv("SLACK_BOT_TOKEN");
  },
  get slackSigningSecret() {
    return requireEnv("SLACK_SIGNING_SECRET");
  },
  get slackDailyChannelId() {
    return requireEnv("SLACK_DAILY_CHANNEL_ID");
  },
  get mongodbUri() {
    return requireEnv("MONGODB_URI");
  },
  get port() {
    return parseInt(optionalEnv("PORT", "3000"), 10);
  },
  get cronSchedule() {
    return optionalEnv("CRON_SCHEDULE", "0 9 * * 1-5");
  },
  get adminTotpSecret() {
    return requireEnv("ADMIN_TOTP_SECRET");
  },
  get jwtSecret() {
    return requireEnv("JWT_SECRET");
  },
  get jwtExpiresIn() {
    return optionalEnv("JWT_EXPIRES_IN", "24h");
  },
  get reminderDelayHours() {
    return parseInt(optionalEnv("REMINDER_DELAY_HOURS", "2"), 10);
  },
};

