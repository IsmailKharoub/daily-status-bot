import { Router, Request, Response } from "express";
import { userService } from "../services";

const router = Router();

// List all users
router.get("/", async (_req: Request, res: Response) => {
  try {
    const users = await userService.listUsers();
    res.json({
      status: "ok",
      count: users.length,
      users: users.map((u) => ({
        email: u.email,
        linearUserId: u.linearUserId,
        slackUserId: u.slackUserId,
        enabled: u.enabled,
        hasLinear: !!u.linearUserId,
        hasSlack: !!u.slackUserId,
        createdAt: u.createdAt,
      })),
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: String(error) });
  }
});

// Add a user by email
router.post("/", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ status: "error", message: "Email is required" });
      return;
    }

    const user = await userService.addUser(email);
    res.json({
      status: "ok",
      message: `User ${email} added`,
      user: {
        email: user.email,
        linearUserId: user.linearUserId,
        slackUserId: user.slackUserId,
        enabled: user.enabled,
        hasLinear: !!user.linearUserId,
        hasSlack: !!user.slackUserId,
      },
    });
  } catch (error) {
    res.status(400).json({ status: "error", message: String(error) });
  }
});

// Remove a user by email
router.delete("/:email", async (req: Request, res: Response) => {
  try {
    const { email } = req.params;
    const removed = await userService.removeUser(email);
    
    if (removed) {
      res.json({ status: "ok", message: `User ${email} removed` });
    } else {
      res.status(404).json({ status: "error", message: `User ${email} not found` });
    }
  } catch (error) {
    res.status(500).json({ status: "error", message: String(error) });
  }
});

// Enable a user
router.post("/:email/enable", async (req: Request, res: Response) => {
  try {
    const { email } = req.params;
    const user = await userService.setUserEnabled(email, true);
    
    if (user) {
      res.json({ status: "ok", message: `User ${email} enabled` });
    } else {
      res.status(404).json({ status: "error", message: `User ${email} not found` });
    }
  } catch (error) {
    res.status(500).json({ status: "error", message: String(error) });
  }
});

// Disable a user
router.post("/:email/disable", async (req: Request, res: Response) => {
  try {
    const { email } = req.params;
    const user = await userService.setUserEnabled(email, false);
    
    if (user) {
      res.json({ status: "ok", message: `User ${email} disabled` });
    } else {
      res.status(404).json({ status: "error", message: `User ${email} not found` });
    }
  } catch (error) {
    res.status(500).json({ status: "error", message: String(error) });
  }
});

// Refresh a user's Linear/Slack IDs
router.post("/:email/refresh", async (req: Request, res: Response) => {
  try {
    const { email } = req.params;
    const user = await userService.refreshUser(email);
    
    if (user) {
      res.json({
        status: "ok",
        message: `User ${email} refreshed`,
        user: {
          email: user.email,
          linearUserId: user.linearUserId,
          slackUserId: user.slackUserId,
          hasLinear: !!user.linearUserId,
          hasSlack: !!user.slackUserId,
        },
      });
    } else {
      res.status(404).json({ status: "error", message: `User ${email} not found` });
    }
  } catch (error) {
    res.status(500).json({ status: "error", message: String(error) });
  }
});

export const usersRoutes = router;

