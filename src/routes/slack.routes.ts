import { Router, Request, Response } from "express";
import { logger } from "../config/logger";
import { verifySlackRequest } from "../middleware/slack-verify";
import { slackService, userService, linearService, historyService } from "../services";
import { sendDailyPrompts, sendDailyPromptForUser } from "../scheduler/daily-prompt";

interface SlackInteractionPayload {
  type: string;
  user: { id: string };
  channel: { id: string };
  message: { ts: string };
  actions: Array<{
    action_id: string;
    selected_options?: Array<{ value: string }>;
    value?: string;
  }>;
  view?: {
    private_metadata?: string;
    state?: {
      values?: Record<string, Record<string, { value?: string }>>;
    };
  };
}

interface SlackCommandPayload {
  command: string;
  user_id: string;
  user_name: string;
  channel_id: string;
  text: string;
  response_url: string;
}

const router = Router();

// Slack interactions (button clicks, checkbox changes, modal submissions)
router.post("/interactions", verifySlackRequest, async (req: Request, res: Response) => {
  try {
    const payload: SlackInteractionPayload = JSON.parse(req.body.payload);
    const slackUserId = payload.user.id;

    // Acknowledge immediately
    res.status(200).send();

    // Handle view submissions (modals)
    if (payload.type === "view_submission") {
      await handleViewSubmission(payload);
      return;
    }

    for (const action of payload.actions) {
      switch (action.action_id) {
        case "select_tickets":
          const selectedIds = action.selected_options?.map((opt) => opt.value) ?? [];
          await slackService.handleTicketSelection(slackUserId, selectedIds);
          logger.debug({ slackUserId, count: selectedIds.length }, "Ticket selection updated");
          break;

        case "submit_daily_status":
          const linearUserId = await userService.getLinearUserIdBySlackId(slackUserId);
          if (linearUserId) {
            await slackService.handleSubmit(
              slackUserId,
              linearUserId,
              payload.channel.id,
              payload.message.ts
            );
            logger.info({ slackUserId }, "Daily status submitted");
          } else {
            logger.error({ slackUserId }, "No Linear mapping found");
          }
          break;

        case "skip_daily":
          await slackService.handleSkip(
            slackUserId,
            payload.channel.id,
            payload.message.ts,
            action.value || "No reason provided"
          );
          logger.info({ slackUserId }, "Daily skipped");
          break;

        case "add_notes":
          await slackService.openNotesModal(slackUserId, payload);
          break;
      }
    }
  } catch (error) {
    logger.error({ error }, "Error handling Slack interaction");
  }
});

async function handleViewSubmission(payload: SlackInteractionPayload): Promise<void> {
  const slackUserId = payload.user.id;
  const metadata = JSON.parse(payload.view?.private_metadata || "{}");
  const values = payload.view?.state?.values || {};

  // Extract notes from the modal
  const notes = values.notes_block?.notes_input?.value || "";
  const blockers = values.blockers_block?.blockers_input?.value || "";

  const linearUserId = await userService.getLinearUserIdBySlackId(slackUserId);
  if (linearUserId) {
    await slackService.handleSubmitWithNotes(
      slackUserId,
      linearUserId,
      metadata.channelId,
      metadata.messageTs,
      notes,
      blockers
    );
    logger.info({ slackUserId, hasNotes: !!notes, hasBlockers: !!blockers }, "Status submitted with notes");
  }
}

// Slash commands
router.post("/commands", verifySlackRequest, async (req: Request, res: Response) => {
  try {
    const payload: SlackCommandPayload = req.body;
    const { command, user_id, text } = payload;

    logger.info({ command, user_id, text }, "Slash command received");

    switch (command) {
      case "/daily":
        await handleDailyCommand(user_id, text, res);
        break;
      case "/skip":
        await handleSkipCommand(user_id, text, res);
        break;
      default:
        res.json({ response_type: "ephemeral", text: `Unknown command: ${command}` });
    }
  } catch (error) {
    logger.error({ error }, "Error handling slash command");
    res.json({ response_type: "ephemeral", text: "Something went wrong. Please try again." });
  }
});

async function handleDailyCommand(userId: string, text: string, res: Response): Promise<void> {
  // Check if user is registered
  const linearUserId = await userService.getLinearUserIdBySlackId(userId);
  if (!linearUserId) {
    res.json({
      response_type: "ephemeral",
      text: "You're not registered for daily standups. Ask your admin to add you.",
    });
    return;
  }

  if (text === "status") {
    // Show today's status
    const status = await historyService.getTodayStatus(userId);
    if (status) {
      const ticketList = status.selectedTickets
        .map((t) => `• <${t.url}|${t.identifier}> ${t.title}`)
        .join("\n");
      res.json({
        response_type: "ephemeral",
        text: `*Your focus today:*\n${ticketList || "_No tickets selected_"}`,
      });
    } else {
      res.json({
        response_type: "ephemeral",
        text: "You haven't submitted your daily status yet. Use `/daily` to get started.",
      });
    }
    return;
  }

  // Send the daily prompt
  res.json({
    response_type: "ephemeral",
    text: "📋 Fetching your tickets...",
  });

  const [tickets, yesterdayStatus] = await Promise.all([
    linearService.getIncompleteTicketsForUser(linearUserId),
    historyService.getYesterdayStatus(userId),
  ]);

  await slackService.sendTicketSelectionDM(userId, tickets, yesterdayStatus);
}

async function handleSkipCommand(userId: string, text: string, res: Response): Promise<void> {
  const linearUserId = await userService.getLinearUserIdBySlackId(userId);
  if (!linearUserId) {
    res.json({
      response_type: "ephemeral",
      text: "You're not registered for daily standups.",
    });
    return;
  }

  await historyService.saveSkip(userId, linearUserId, text || "Skipped via command");
  
  res.json({
    response_type: "ephemeral",
    text: `✓ Skipped today's standup${text ? `: ${text}` : ""}`,
  });
}

// Debug endpoint - fetch tickets without sending Slack message
router.get("/debug/:email", async (req: Request, res: Response) => {
  try {
    const email = req.params.email.toLowerCase();
    logger.debug({ email }, "Debug: fetching tickets");

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
    logger.error({ error }, "Debug failed");
    res.status(500).json({ status: "error", message: String(error) });
  }
});

// Manual trigger - send to all enabled users (unprotected for testing)
router.post("/trigger", async (_req: Request, res: Response) => {
  try {
    logger.info("Manual trigger: sending daily prompts to all enabled users");
    await sendDailyPrompts();
    res.json({ status: "ok", message: "Daily prompts sent to all enabled users" });
  } catch (error) {
    logger.error({ error }, "Manual trigger failed");
    res.status(500).json({ status: "error", message: String(error) });
  }
});

// Manual trigger - send to specific user by email
router.post("/trigger/:email", async (req: Request, res: Response) => {
  try {
    const email = req.params.email.toLowerCase();
    logger.info({ email }, "Manual trigger for user");

    const result = await sendDailyPromptForUser(email);
    
    if (result.success) {
      res.json({ status: "ok", ...result });
    } else {
      res.status(404).json({ status: "error", message: result.message });
    }
  } catch (error) {
    logger.error({ error }, "Manual trigger failed");
    res.status(500).json({ status: "error", message: String(error) });
  }
});

// Health check endpoint
router.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

export const slackRoutes = router;
