import { Router, Request, Response } from "express";
import { slackService, userService, linearService, historyService } from "../services";
import { sendDailyPrompts } from "../scheduler/daily-prompt";
import { EnabledUser } from "../models";

interface SlackInteractionPayload {
  type: string;
  user: { id: string };
  channel: { id: string };
  message: { ts: string };
  actions: Array<{
    action_id: string;
    selected_options?: Array<{ value: string }>;
  }>;
}

const router = Router();

router.post("/interactions", async (req: Request, res: Response) => {
  try {
    const payload: SlackInteractionPayload = JSON.parse(req.body.payload);
    const slackUserId = payload.user.id;

    // Acknowledge immediately
    res.status(200).send();

    for (const action of payload.actions) {
      if (action.action_id === "select_tickets") {
        const selectedIds =
          action.selected_options?.map((opt) => opt.value) ?? [];
        await slackService.handleTicketSelection(slackUserId, selectedIds);
      }

      if (action.action_id === "submit_daily_status") {
        const linearUserId =
          await userService.getLinearUserIdBySlackId(slackUserId);

        if (linearUserId) {
          await slackService.handleSubmit(
            slackUserId,
            linearUserId,
            payload.channel.id,
            payload.message.ts
          );
        } else {
          console.error(
            `No Linear user mapping found for Slack user ${slackUserId}`
          );
        }
      }
    }
  } catch (error) {
    console.error("Error handling Slack interaction:", error);
    // Don't send error response as we already acknowledged
  }
});

// Debug endpoint - fetch tickets without sending Slack message
router.get("/debug/:email", async (req: Request, res: Response) => {
  try {
    const email = req.params.email.toLowerCase();
    console.log(`Debug: fetching tickets for ${email}...`);

    const linearUsers = await linearService.getAllUsers();
    const linearUser = linearUsers.find(
      (u) => u.email?.toLowerCase() === email
    );

    if (!linearUser) {
      res.status(404).json({ status: "error", message: `No Linear user found with email: ${email}` });
      return;
    }

    const tickets = await linearService.getIncompleteTicketsForUser(linearUser.id);

    res.json({
      status: "ok",
      email,
      linearUserId: linearUser.id,
      ticketCount: tickets.length,
      tickets: tickets.map((t) => ({
        id: t.id,
        identifier: t.identifier,
        title: t.title,
        status: t.status,
        url: t.url,
      })),
    });
  } catch (error) {
    console.error("Debug failed:", error);
    res.status(500).json({ status: "error", message: String(error) });
  }
});

// Manual trigger - send to all enabled users
router.post("/trigger", async (_req: Request, res: Response) => {
  try {
    console.log("Manual trigger: sending daily prompts to all enabled users...");
    await sendDailyPrompts();
    res.json({ status: "ok", message: "Daily prompts sent to all enabled users" });
  } catch (error) {
    console.error("Manual trigger failed:", error);
    res.status(500).json({ status: "error", message: String(error) });
  }
});

// Manual trigger - send to specific user by email (must be in enabled users list)
router.post("/trigger/:email", async (req: Request, res: Response) => {
  try {
    const email = req.params.email.toLowerCase();
    console.log(`Manual trigger: sending daily prompt to ${email}...`);

    // Get enabled users and find this one
    const enabledUsers = await userService.getEnabledUsers();
    
    // Find the user's Linear ID by checking the enabled users
    let linearUserId: string | null = null;
    let slackUserId: string | null = null;
    
    for (const [linId, slackId] of enabledUsers) {
      // We need to check email - let's look it up
      const linearUsers = await linearService.getAllUsers();
      const linearUser = linearUsers.find((u) => u.id === linId);
      if (linearUser?.email?.toLowerCase() === email) {
        linearUserId = linId;
        slackUserId = slackId;
        break;
      }
    }

    if (!linearUserId || !slackUserId) {
      res.status(404).json({ 
        status: "error", 
        message: `User ${email} not found in enabled users. Add them first via POST /users` 
      });
      return;
    }

    const [tickets, yesterdayStatus] = await Promise.all([
      linearService.getIncompleteTicketsForUser(linearUserId),
      historyService.getYesterdayStatus(slackUserId),
    ]);

    await slackService.sendTicketSelectionDM(slackUserId, tickets, yesterdayStatus);

    res.json({
      status: "ok",
      message: `Daily prompt sent to ${email}`,
      ticketCount: tickets.length,
      hasYesterdayStatus: !!yesterdayStatus,
    });
  } catch (error) {
    console.error("Manual trigger failed:", error);
    res.status(500).json({ status: "error", message: String(error) });
  }
});

// Health check endpoint
router.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

export const slackRoutes = router;

