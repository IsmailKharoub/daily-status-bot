Here are the key TypeScript snippets for each component:

---

## 1. Linear Client - Fetch Incomplete Tickets

```typescript
import { LinearClient } from "@linear/sdk";

interface Ticket {
  id: string;
  identifier: string; // e.g., "ENG-123"
  title: string;
  status: string;
  url: string;
}

const linear = new LinearClient({ apiKey: process.env.LINEAR_API_KEY });

async function getIncompleteTicketsForUser(userId: string): Promise<Ticket[]> {
  const issues = await linear.issues({
    filter: {
      assignee: { id: { eq: userId } },
      state: {
        type: { nin: ["completed", "canceled"] },
      },
    },
  });

  return issues.nodes.map((issue) => ({
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    status: issue.state?.name ?? "Unknown",
    url: issue.url,
  }));
}
```

---

## 2. Slack - Send Interactive Message

```typescript
import { WebClient } from "@slack/web-api";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

async function sendTicketSelectionDM(
  slackUserId: string,
  tickets: Ticket[]
): Promise<void> {
  const checkboxOptions = tickets.map((ticket) => ({
    text: {
      type: "mrkdwn" as const,
      text: `*<${ticket.url}|${ticket.identifier}>* ${ticket.title}`,
    },
    value: ticket.id,
  }));

  await slack.chat.postMessage({
    channel: slackUserId,
    text: "What are you working on today?",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "🎯 *What are you working on today?*\nSelect the tickets you'll focus on:",
        },
      },
      {
        type: "actions",
        block_id: "ticket_selection",
        elements: [
          {
            type: "checkboxes",
            action_id: "select_tickets",
            options: checkboxOptions,
          },
        ],
      },
      {
        type: "actions",
        block_id: "submit_block",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Submit" },
            style: "primary",
            action_id: "submit_daily_status",
          },
        ],
      },
    ],
  });
}
```

---

## 3. Handle Button Interaction

```typescript
import type { Request, Response } from "express";

// In-memory store (replace with Redis/DB in production)
const pendingSelections = new Map<string, string[]>();

async function handleSlackInteraction(req: Request, res: Response) {
  const payload = JSON.parse(req.body.payload);
  const userId = payload.user.id;

  for (const action of payload.actions) {
    if (action.action_id === "select_tickets") {
      // Store selections as user checks/unchecks
      const selectedIds = action.selected_options.map(
        (opt: { value: string }) => opt.value
      );
      pendingSelections.set(userId, selectedIds);
    }

    if (action.action_id === "submit_daily_status") {
      const selectedTicketIds = pendingSelections.get(userId) ?? [];
      await postDailyStatus(userId, selectedTicketIds);
      pendingSelections.delete(userId);

      // Update the original message
      await slack.chat.update({
        channel: payload.channel.id,
        ts: payload.message.ts,
        text: "✅ Status submitted!",
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "✅ *Status submitted!*" },
          },
        ],
      });
    }
  }

  res.status(200).send();
}
```

---

## 4. Post to Daily Channel

```typescript
const DAILY_CHANNEL_ID = process.env.SLACK_DAILY_CHANNEL_ID!;

async function postDailyStatus(
  slackUserId: string,
  ticketIds: string[]
): Promise<void> {
  // Fetch ticket details from Linear
  const ticketDetails = await Promise.all(
    ticketIds.map((id) => linear.issue(id))
  );

  const ticketLines = ticketDetails
    .map((ticket) => `• <${ticket.url}|${ticket.identifier}> ${ticket.title}`)
    .join("\n");

  const message =
    ticketIds.length > 0
      ? `📋 *<@${slackUserId}>'s focus today:*\n${ticketLines}`
      : `📋 *<@${slackUserId}>* has no tickets selected for today.`;

  await slack.chat.postMessage({
    channel: DAILY_CHANNEL_ID,
    text: message,
    unfurl_links: false,
  });
}
```

---

## 5. User Mapping

```typescript
// Simple config-based mapping (could also match by email)
interface UserMapping {
  linearUserId: string;
  slackUserId: string;
}

const userMappings: UserMapping[] = [
  { linearUserId: "lin_abc123", slackUserId: "U01ABC123" },
  { linearUserId: "lin_def456", slackUserId: "U01DEF456" },
  // ...
];

// Or fetch dynamically by matching emails
async function buildUserMappingByEmail(): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();

  // Get Linear users
  const linearUsers = await linear.users();

  // Get Slack users
  const slackUsers = await slack.users.list();

  for (const linearUser of linearUsers.nodes) {
    const slackUser = slackUsers.members?.find(
      (su) => su.profile?.email === linearUser.email
    );
    if (slackUser?.id) {
      mapping.set(linearUser.id, slackUser.id);
    }
  }

  return mapping;
}
```

---

## 6. Scheduler / Main Loop

```typescript
import cron from "node-cron";

// Run every weekday at 9:00 AM
cron.schedule("0 9 * * 1-5", async () => {
  console.log("Starting daily status collection...");

  const userMapping = await buildUserMappingByEmail();

  for (const [linearUserId, slackUserId] of userMapping) {
    try {
      const tickets = await getIncompleteTicketsForUser(linearUserId);

      if (tickets.length > 0) {
        await sendTicketSelectionDM(slackUserId, tickets);
      } else {
        // Optionally notify users with no tickets
        await slack.chat.postMessage({
          channel: slackUserId,
          text: "You have no open tickets in Linear. Enjoy your day! 🎉",
        });
      }
    } catch (error) {
      console.error(`Failed for user ${linearUserId}:`, error);
    }
  }
});
```

---

## Dependencies

```json
{
  "dependencies": {
    "@linear/sdk": "^2.0.0",
    "@slack/web-api": "^6.9.0",
    "node-cron": "^3.0.0",
    "express": "^4.18.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/express": "^4.17.0",
    "typescript": "^5.0.0"
  }
}
```

---
Yes, absolutely! That's the cleanest approach. Here's how:

```typescript
async function buildUserMappingByEmail(): Promise<Map<string, string>> {
  const mapping = new Map<string, string>(); // linearUserId → slackUserId

  // Get all Linear users
  const linearUsers = await linear.users();

  // Get all Slack users
  const slackUsers = await slack.users.list();

  for (const linearUser of linearUsers.nodes) {
    if (!linearUser.email) continue;

    const slackUser = slackUsers.members?.find(
      (su) => su.profile?.email?.toLowerCase() === linearUser.email?.toLowerCase()
    );

    if (slackUser?.id) {
      mapping.set(linearUser.id, slackUser.id);
    } else {
      console.warn(`No Slack user found for ${linearUser.email}`);
    }
  }

  return mapping;
}
```

---

### Caveats

| Issue | Solution |
|-------|----------|
| **Slack email requires scope** | Add `users:read.email` to your bot's OAuth scopes |
| **Pagination** | Both APIs paginate - use cursors for large teams (100+ users) |
| **Rate limits** | Cache the mapping and refresh daily, not per-request |
| **Email mismatches** | Some people use different emails - add a manual override map |

---

### With Manual Overrides

```typescript
const manualOverrides: Record<string, string> = {
  "jane@company.com": "U01SLACK123", // Jane uses personal email in Linear
};

async function buildUserMappingByEmail(): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  const slackUsers = await slack.users.list();
  const linearUsers = await linear.users();

  for (const linearUser of linearUsers.nodes) {
    const email = linearUser.email?.toLowerCase();
    if (!email) continue;

    // Check manual override first
    if (manualOverrides[email]) {
      mapping.set(linearUser.id, manualOverrides[email]);
      continue;
    }

    // Otherwise match by email
    const slackUser = slackUsers.members?.find(
      (su) => su.profile?.email?.toLowerCase() === email
    );

    if (slackUser?.id) {
      mapping.set(linearUser.id, slackUser.id);
    }
  }

  return mapping;
}
```

