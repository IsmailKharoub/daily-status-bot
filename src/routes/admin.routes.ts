import { Router, Request, Response } from "express";
import path from "path";
import { logger } from "../config/logger";
import { verifyJWT, generateToken, verifyTOTP } from "../middleware/auth";
import { authLimiter, apiLimiter } from "../middleware/rate-limit";
import { userService } from "../services";
import { getSetting, setSetting, DailyStatus, EnabledUser } from "../models";
import {
  getScheduleSettings,
  updateSchedule,
  sendDailyPrompts,
  sendDailyPromptForUser,
  COMMON_TIMEZONES,
} from "../scheduler/daily-prompt";
import {
  authSchema,
  addUserSchema,
  scheduleSchema,
  settingsSchema,
} from "../validation";

const router = Router();

// Helper for date operations
function getStartOfDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

// Verify TOTP and issue JWT
router.post("/api/auth", authLimiter, (req: Request, res: Response) => {
  const result = authSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message });
    return;
  }

  const { code } = result.data;
  
  if (verifyTOTP(code)) {
    const token = generateToken();
    logger.info("Admin authenticated successfully");
    res.json({ success: true, token });
  } else {
    logger.warn("Failed admin authentication attempt");
    res.status(401).json({ error: "Invalid code" });
  }
});

// Serve admin UI
router.get("/", (_req: Request, res: Response) => {
  const publicPath = path.join(__dirname, "../public/admin.html");
  res.sendFile(publicPath);
});

// Apply rate limiting and JWT verification to all API routes below
router.use("/api", apiLimiter);

// API routes (all require auth except /auth)
router.get("/api/users", verifyJWT, async (_req: Request, res: Response) => {
  try {
    const users = await userService.listUsers();
    res.json(users.map((u) => ({
      email: u.email,
      linearUserId: u.linearUserId,
      slackUserId: u.slackUserId,
      enabled: u.enabled,
      createdAt: u.createdAt,
    })));
  } catch (error) {
    logger.error({ error }, "Failed to list users");
    res.status(500).json({ error: String(error) });
  }
});

router.post("/api/users", verifyJWT, async (req: Request, res: Response) => {
  const result = addUserSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message });
    return;
  }

  try {
    const { email } = result.data;
    logger.info({ email }, "Adding user");
    const user = await userService.addUser(email);
    logger.info({ email: user.email }, "User added successfully");
    res.json({
      email: user.email,
      linearUserId: user.linearUserId,
      slackUserId: user.slackUserId,
      enabled: user.enabled,
    });
  } catch (error) {
    logger.error({ error }, "Failed to add user");
    res.status(400).json({ error: String(error) });
  }
});

router.delete("/api/users/:email", verifyJWT, async (req: Request, res: Response) => {
  try {
    const removed = await userService.removeUser(req.params.email);
    if (removed) {
      logger.info({ email: req.params.email }, "User removed");
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  } catch (error) {
    logger.error({ error }, "Failed to remove user");
    res.status(500).json({ error: String(error) });
  }
});

router.post("/api/users/:email/toggle", verifyJWT, async (req: Request, res: Response) => {
  try {
    const users = await userService.listUsers();
    const user = users.find((u) => u.email === req.params.email.toLowerCase());
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const updated = await userService.setUserEnabled(req.params.email, !user.enabled);
    logger.info({ email: req.params.email, enabled: updated?.enabled }, "User toggled");
    res.json({ enabled: updated?.enabled });
  } catch (error) {
    logger.error({ error }, "Failed to toggle user");
    res.status(500).json({ error: String(error) });
  }
});

router.post("/api/users/:email/refresh", verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = await userService.refreshUser(req.params.email);
    if (user) {
      logger.info({ email: req.params.email }, "User refreshed");
      res.json({
        email: user.email,
        linearUserId: user.linearUserId,
        slackUserId: user.slackUserId,
      });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  } catch (error) {
    logger.error({ error }, "Failed to refresh user");
    res.status(500).json({ error: String(error) });
  }
});

// Schedule management
router.get("/api/schedule", verifyJWT, async (_req: Request, res: Response) => {
  try {
    const settings = await getScheduleSettings();
    res.json({
      ...settings,
      timezones: COMMON_TIMEZONES,
    });
  } catch (error) {
    logger.error({ error }, "Failed to get schedule");
    res.status(500).json({ error: String(error) });
  }
});

router.post("/api/schedule", verifyJWT, async (req: Request, res: Response) => {
  const result = scheduleSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message });
    return;
  }

  try {
    const { cronSchedule, timezone } = result.data;
    const updateResult = await updateSchedule(cronSchedule, timezone);
    
    if (updateResult.success) {
      logger.info({ cronSchedule, timezone }, "Schedule updated");
      const settings = await getScheduleSettings();
      res.json(settings);
    } else {
      res.status(400).json({ error: updateResult.error });
    }
  } catch (error) {
    logger.error({ error }, "Failed to update schedule");
    res.status(500).json({ error: String(error) });
  }
});

// Manual trigger (all users)
router.post("/api/trigger", verifyJWT, async (_req: Request, res: Response) => {
  try {
    logger.info("Manual trigger: sending daily prompts to all users");
    sendDailyPrompts().catch((err) => logger.error({ err }, "Daily prompts failed"));
    res.json({ success: true, message: "Daily prompts triggered" });
  } catch (error) {
    logger.error({ error }, "Failed to trigger daily prompts");
    res.status(500).json({ error: String(error) });
  }
});

// Manual trigger for specific user
router.post("/api/trigger/:email", verifyJWT, async (req: Request, res: Response) => {
  try {
    const { email } = req.params;
    logger.info({ email }, "Manual trigger for user");
    const result = await sendDailyPromptForUser(email);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json({ error: result.message });
    }
  } catch (error) {
    logger.error({ error }, "Failed to trigger for user");
    res.status(500).json({ error: String(error) });
  }
});

// Settings management
router.get("/api/settings", verifyJWT, async (_req: Request, res: Response) => {
  try {
    const channelId = await getSetting("slackDailyChannelId", "");
    res.json({ channelId });
  } catch (error) {
    logger.error({ error }, "Failed to get settings");
    res.status(500).json({ error: String(error) });
  }
});

router.post("/api/settings", verifyJWT, async (req: Request, res: Response) => {
  const result = settingsSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message });
    return;
  }

  try {
    const { channelId } = result.data;
    await setSetting("slackDailyChannelId", channelId);
    logger.info({ channelId }, "Channel ID updated");
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Failed to update settings");
    res.status(500).json({ error: String(error) });
  }
});

// Team status dashboard
router.get("/api/status/today", verifyJWT, async (_req: Request, res: Response) => {
  try {
    const today = getStartOfDay(new Date());
    const [statuses, enabledUsers] = await Promise.all([
      DailyStatus.find({ date: today }),
      EnabledUser.find({ enabled: true }),
    ]);

    const submittedIds = new Set(statuses.map((s) => s.slackUserId));
    
    const submitted = statuses.map((s) => {
      const user = enabledUsers.find((u) => u.slackUserId === s.slackUserId);
      return {
        email: user?.email || "unknown",
        ticketCount: s.selectedTickets.length,
        submittedAt: s.submittedAt,
        tickets: s.selectedTickets,
      };
    });

    const pending = enabledUsers
      .filter((u) => u.slackUserId && !submittedIds.has(u.slackUserId))
      .map((u) => ({ email: u.email }));

    res.json({
      date: today.toISOString().split("T")[0],
      submitted,
      pending,
      stats: {
        total: enabledUsers.length,
        submittedCount: submitted.length,
        pendingCount: pending.length,
      },
    });
  } catch (error) {
    logger.error({ error }, "Failed to get today's status");
    res.status(500).json({ error: String(error) });
  }
});

// Status history for a user
router.get("/api/status/:email/history", verifyJWT, async (req: Request, res: Response) => {
  try {
    const { email } = req.params;
    const days = parseInt(req.query.days as string) || 7;
    
    const user = await EnabledUser.findOne({ email: email.toLowerCase() });
    if (!user || !user.slackUserId) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const history = await DailyStatus.find({
      slackUserId: user.slackUserId,
      date: { $gte: getStartOfDay(startDate) },
    }).sort({ date: -1 });

    res.json({
      email,
      days,
      history: history.map((h) => ({
        date: h.date.toISOString().split("T")[0],
        ticketCount: h.selectedTickets.length,
        tickets: h.selectedTickets,
        submittedAt: h.submittedAt,
      })),
    });
  } catch (error) {
    logger.error({ error }, "Failed to get user history");
    res.status(500).json({ error: String(error) });
  }
});

export const adminRoutes = router;
