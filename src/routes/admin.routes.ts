import { Router, Request, Response, NextFunction } from "express";
import path from "path";
import { authenticator } from "otplib";
import { env } from "../config/env";
import { userService } from "../services";
import {
  getScheduleSettings,
  updateSchedule,
  sendDailyPrompts,
  COMMON_TIMEZONES,
} from "../scheduler/daily-prompt";

const router = Router();

// Store valid tokens temporarily (valid for 5 minutes after verification)
const validSessions = new Map<string, number>();
const SESSION_DURATION = 5 * 60 * 1000; // 5 minutes

// Clean up expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, expiry] of validSessions) {
    if (now > expiry) validSessions.delete(token);
  }
}, 60 * 1000);

// Auth middleware - verifies TOTP code or valid session token
function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.headers["x-admin-key"] as string || req.query.key as string;
  
  // Check if it's a valid session token
  if (token && validSessions.has(token)) {
    const expiry = validSessions.get(token)!;
    if (Date.now() < expiry) {
      // Extend session on activity
      validSessions.set(token, Date.now() + SESSION_DURATION);
      return next();
    }
    validSessions.delete(token);
  }
  
  res.status(401).json({ error: "Unauthorized" });
}

// Verify TOTP and create session
router.post("/api/auth", (req: Request, res: Response) => {
  const { code } = req.body;
  
  if (!code || typeof code !== "string") {
    res.status(400).json({ error: "Code required" });
    return;
  }
  
  const isValid = authenticator.verify({
    token: code,
    secret: env.adminTotpSecret,
  });
  
  if (isValid) {
    // Generate session token
    const sessionToken = authenticator.generateSecret();
    validSessions.set(sessionToken, Date.now() + SESSION_DURATION);
    res.json({ success: true, token: sessionToken });
  } else {
    res.status(401).json({ error: "Invalid code" });
  }
});


// Serve admin UI
router.get("/", (_req: Request, res: Response) => {
  const publicPath = path.join(__dirname, "../public/admin.html");
  res.sendFile(publicPath);
});

// API routes (all require auth)
router.get("/api/users", authMiddleware, async (_req: Request, res: Response) => {
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
    res.status(500).json({ error: String(error) });
  }
});

router.post("/api/users", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: "Email required" });
      return;
    }
    const user = await userService.addUser(email);
    res.json({
      email: user.email,
      linearUserId: user.linearUserId,
      slackUserId: user.slackUserId,
      enabled: user.enabled,
    });
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

router.delete("/api/users/:email", authMiddleware, async (req: Request, res: Response) => {
  try {
    const removed = await userService.removeUser(req.params.email);
    if (removed) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post("/api/users/:email/toggle", authMiddleware, async (req: Request, res: Response) => {
  try {
    const users = await userService.listUsers();
    const user = users.find((u) => u.email === req.params.email.toLowerCase());
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const updated = await userService.setUserEnabled(req.params.email, !user.enabled);
    res.json({ enabled: updated?.enabled });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post("/api/users/:email/refresh", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = await userService.refreshUser(req.params.email);
    if (user) {
      res.json({
        email: user.email,
        linearUserId: user.linearUserId,
        slackUserId: user.slackUserId,
      });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Schedule management
router.get("/api/schedule", authMiddleware, async (_req: Request, res: Response) => {
  try {
    const settings = await getScheduleSettings();
    res.json({
      ...settings,
      timezones: COMMON_TIMEZONES,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post("/api/schedule", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { cronSchedule, timezone } = req.body;
    
    if (!cronSchedule || !timezone) {
      res.status(400).json({ error: "cronSchedule and timezone are required" });
      return;
    }

    const result = await updateSchedule(cronSchedule, timezone);
    
    if (result.success) {
      const settings = await getScheduleSettings();
      res.json(settings);
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Manual trigger
router.post("/api/trigger", authMiddleware, async (_req: Request, res: Response) => {
  try {
    // Run in background, respond immediately
    sendDailyPrompts().catch(console.error);
    res.json({ success: true, message: "Daily prompts triggered" });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export const adminRoutes = router;

