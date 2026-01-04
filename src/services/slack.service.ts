import { WebClient } from "@slack/web-api";
import { env } from "../config/env";
import { PendingSelection, IDailyStatus, ISelectedTicket } from "../models";
import { Ticket, linearService } from "./linear.service";
import { historyService } from "./history.service";

class SlackService {
  private _client: WebClient | null = null;

  private get client(): WebClient {
    if (!this._client) {
      this._client = new WebClient(env.slackBotToken);
    }
    return this._client;
  }

  private truncateForCheckbox(url: string, identifier: string, title: string): string {
    const prefix = `*<${url}|${identifier}>* `;
    const maxLength = 150;
    const availableLength = maxLength - prefix.length;
    
    const truncatedTitle = title.length > availableLength
      ? title.slice(0, availableLength - 3) + "..."
      : title;
    
    return `${prefix}${truncatedTitle}`;
  }

  async sendTicketSelectionDM(
    slackUserId: string,
    tickets: Ticket[],
    yesterdayStatus: IDailyStatus | null
  ): Promise<void> {
    const blocks: any[] = [];

    // Yesterday's focus section
    if (yesterdayStatus && yesterdayStatus.selectedTickets.length > 0) {
      const yesterdayLines = yesterdayStatus.selectedTickets
        .map((t) => `• <${t.url}|${t.identifier}> ${t.title}`)
        .join("\n");

      blocks.push(
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📝 *Yesterday's Focus:*\n${yesterdayLines}`,
          },
        },
        { type: "divider" }
      );
    }

    // Today's selection section
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "🎯 *What are you working on today?*\nSelect the tickets you'll focus on:",
      },
    });

    if (tickets.length > 0) {
      const checkboxOptions = tickets.map((ticket) => ({
        text: {
          type: "mrkdwn" as const,
          text: this.truncateForCheckbox(ticket.url, ticket.identifier, ticket.title),
        },
        value: ticket.id,
      }));

      blocks.push(
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
        }
      );
    } else {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "_No open tickets in your active cycle._",
        },
      });
    }

    const result = await this.client.chat.postMessage({
      channel: slackUserId,
      text: "What are you working on today?",
      blocks,
    });

    // Store pending selection with 24-hour expiry
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    await PendingSelection.findOneAndUpdate(
      { slackUserId },
      {
        slackUserId,
        selectedTicketIds: [],
        messageTs: result.ts,
        createdAt: new Date(),
        expiresAt,
      },
      { upsert: true }
    );
  }

  async handleTicketSelection(
    slackUserId: string,
    selectedTicketIds: string[]
  ): Promise<void> {
    await PendingSelection.findOneAndUpdate(
      { slackUserId },
      { selectedTicketIds }
    );
  }

  async handleSubmit(
    slackUserId: string,
    linearUserId: string,
    channelId: string,
    messageTs: string
  ): Promise<void> {
    const pending = await PendingSelection.findOne({ slackUserId });
    const selectedTicketIds = pending?.selectedTicketIds ?? [];

    // Fetch ticket details
    const tickets = await linearService.getTicketsByIds(selectedTicketIds);
    const selectedTickets: ISelectedTicket[] = tickets.map((t) => ({
      ticketId: t.id,
      identifier: t.identifier,
      title: t.title,
      url: t.url,
    }));

    // Save to history
    await historyService.saveDailyStatus(
      slackUserId,
      linearUserId,
      selectedTickets
    );

    // Post to daily channel
    await this.postDailyStatus(slackUserId, selectedTickets);

    // Update original message
    await this.client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: "✅ Status submitted!",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              selectedTickets.length > 0
                ? `✅ *Status submitted!*\n\nYour focus today:\n${selectedTickets
                    .map((t) => `• <${t.url}|${t.identifier}> ${t.title}`)
                    .join("\n")}`
                : "✅ *Status submitted!*\n\n_No tickets selected for today._",
          },
        },
      ],
    });

    // Clean up pending selection
    await PendingSelection.deleteOne({ slackUserId });
  }

  async postDailyStatus(
    slackUserId: string,
    tickets: ISelectedTicket[]
  ): Promise<void> {
    const ticketLines = tickets
      .map((t) => `• <${t.url}|${t.identifier}> ${t.title}`)
      .join("\n");

    const message =
      tickets.length > 0
        ? `📋 *<@${slackUserId}>'s focus today:*\n${ticketLines}`
        : `📋 *<@${slackUserId}>* has no tickets selected for today.`;

    await this.client.chat.postMessage({
      channel: env.slackDailyChannelId,
      text: message,
      unfurl_links: false,
    });
  }

  async getAllUsers(): Promise<
    { id: string; email: string | undefined }[]
  > {
    const result = await this.client.users.list({});
    return (
      result.members
        ?.filter((m) => !m.is_bot && !m.deleted && m.id)
        .map((m) => ({
          id: m.id!,
          email: m.profile?.email,
        })) ?? []
    );
  }

  async sendNoTicketsMessage(slackUserId: string): Promise<void> {
    await this.client.chat.postMessage({
      channel: slackUserId,
      text: "You have no open tickets in your active Linear cycle. Enjoy your day! 🎉",
    });
  }
}

export const slackService = new SlackService();

