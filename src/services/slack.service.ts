import { WebClient, KnownBlock, Block } from "@slack/web-api";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { PendingSelection, IDailyStatus, ISelectedTicket, getSetting } from "../models";
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
    const blocks: KnownBlock[] = [];

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
              text: { type: "plain_text", text: "Submit", emoji: true },
              style: "primary",
              action_id: "submit_daily_status",
            },
            {
              type: "button",
              text: { type: "plain_text", text: "Add Notes", emoji: true },
              action_id: "add_notes",
            },
            {
              type: "button",
              text: { type: "plain_text", text: "Skip Today", emoji: true },
              action_id: "skip_daily",
              value: "No specific reason",
            },
          ],
        }
      );
    } else {
      blocks.push(
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "_No open tickets in your active cycle._",
          },
        },
        {
          type: "actions",
          block_id: "no_tickets_actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Skip Today", emoji: true },
              action_id: "skip_daily",
              value: "No tickets available",
            },
          ],
        }
      );
    }

    const result = await this.client.chat.postMessage({
      channel: slackUserId,
      text: "What are you working on today?",
      blocks: blocks as Block[],
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

    logger.info({ slackUserId, ticketCount: tickets.length }, "Sent ticket selection DM");
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
    await this.updateMessageToSubmitted(channelId, messageTs, selectedTickets);

    // Clean up pending selection
    await PendingSelection.deleteOne({ slackUserId });
  }

  async handleSubmitWithNotes(
    slackUserId: string,
    linearUserId: string,
    channelId: string,
    messageTs: string,
    notes: string,
    blockers: string
  ): Promise<void> {
    const pending = await PendingSelection.findOne({ slackUserId });
    const selectedTicketIds = pending?.selectedTicketIds ?? [];

    const tickets = await linearService.getTicketsByIds(selectedTicketIds);
    const selectedTickets: ISelectedTicket[] = tickets.map((t) => ({
      ticketId: t.id,
      identifier: t.identifier,
      title: t.title,
      url: t.url,
    }));

    // Save to history with notes
    await historyService.saveDailyStatus(
      slackUserId,
      linearUserId,
      selectedTickets,
      notes,
      blockers
    );

    // Post to daily channel with notes
    await this.postDailyStatusWithNotes(slackUserId, selectedTickets, notes, blockers);

    // Update original message
    await this.updateMessageToSubmitted(channelId, messageTs, selectedTickets, notes, blockers);

    // Clean up
    await PendingSelection.deleteOne({ slackUserId });
  }

  async handleSkip(
    slackUserId: string,
    channelId: string,
    messageTs: string,
    reason: string
  ): Promise<void> {
    const linearUserId = await this.getLinearUserIdFromPending(slackUserId);
    
    if (linearUserId) {
      await historyService.saveSkip(slackUserId, linearUserId, reason);
    }

    // Update the message
    await this.client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: "⏭️ Skipped today",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `⏭️ *Skipped today's standup*${reason ? `\n_Reason: ${reason}_` : ""}`,
          },
        },
      ],
    });

    await PendingSelection.deleteOne({ slackUserId });

    // Optionally post to channel
    const channelId2 = await getSetting("slackDailyChannelId", env.slackDailyChannelId);
    await this.client.chat.postMessage({
      channel: channelId2,
      text: `⏭️ <@${slackUserId}> skipped today's standup${reason ? `: ${reason}` : ""}`,
      unfurl_links: false,
    });
  }

  private async getLinearUserIdFromPending(slackUserId: string): Promise<string | null> {
    // This is a helper - ideally we'd store linearUserId in PendingSelection
    // For now, we'll look it up from EnabledUser
    const { EnabledUser } = await import("../models");
    const user = await EnabledUser.findOne({ slackUserId });
    return user?.linearUserId ?? null;
  }

  async openNotesModal(slackUserId: string, payload: any): Promise<void> {
    const triggerId = payload.trigger_id;
    
    await this.client.views.open({
      trigger_id: triggerId,
      view: {
        type: "modal",
        callback_id: "submit_with_notes",
        private_metadata: JSON.stringify({
          channelId: payload.channel.id,
          messageTs: payload.message.ts,
        }),
        title: { type: "plain_text", text: "Add Notes" },
        submit: { type: "plain_text", text: "Submit" },
        close: { type: "plain_text", text: "Cancel" },
        blocks: [
          {
            type: "input",
            block_id: "notes_block",
            optional: true,
            element: {
              type: "plain_text_input",
              action_id: "notes_input",
              multiline: true,
              placeholder: { type: "plain_text", text: "Any additional context or notes?" },
            },
            label: { type: "plain_text", text: "Notes" },
          },
          {
            type: "input",
            block_id: "blockers_block",
            optional: true,
            element: {
              type: "plain_text_input",
              action_id: "blockers_input",
              multiline: true,
              placeholder: { type: "plain_text", text: "Any blockers or dependencies?" },
            },
            label: { type: "plain_text", text: "Blockers" },
          },
        ],
      },
    });
  }

  private async updateMessageToSubmitted(
    channelId: string,
    messageTs: string,
    tickets: ISelectedTicket[],
    notes?: string,
    blockers?: string
  ): Promise<void> {
    const ticketList = tickets.length > 0
      ? tickets.map((t) => `• <${t.url}|${t.identifier}> ${t.title}`).join("\n")
      : "_No tickets selected_";

    let text = `✅ *Status submitted!*\n\n*Your focus today:*\n${ticketList}`;
    
    if (notes) {
      text += `\n\n*Notes:* ${notes}`;
    }
    if (blockers) {
      text += `\n\n*Blockers:* 🚧 ${blockers}`;
    }

    await this.client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: "✅ Status submitted!",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text },
        },
      ],
    });
  }

  async postDailyStatus(
    slackUserId: string,
    tickets: ISelectedTicket[]
  ): Promise<void> {
    const channelId = await getSetting("slackDailyChannelId", env.slackDailyChannelId);
    
    const ticketLines = tickets
      .map((t) => `• <${t.url}|${t.identifier}> ${t.title}`)
      .join("\n");

    const message =
      tickets.length > 0
        ? `📋 *<@${slackUserId}>'s focus today:*\n${ticketLines}`
        : `📋 *<@${slackUserId}>* has no tickets selected for today.`;

    await this.client.chat.postMessage({
      channel: channelId,
      text: message,
      unfurl_links: false,
    });
  }

  async postDailyStatusWithNotes(
    slackUserId: string,
    tickets: ISelectedTicket[],
    notes: string,
    blockers: string
  ): Promise<void> {
    const channelId = await getSetting("slackDailyChannelId", env.slackDailyChannelId);
    
    const ticketLines = tickets
      .map((t) => `• <${t.url}|${t.identifier}> ${t.title}`)
      .join("\n");

    let message = tickets.length > 0
      ? `📋 *<@${slackUserId}>'s focus today:*\n${ticketLines}`
      : `📋 *<@${slackUserId}>* has no tickets selected for today.`;

    if (notes) {
      message += `\n\n💬 *Notes:* ${notes}`;
    }
    if (blockers) {
      message += `\n\n🚧 *Blockers:* ${blockers}`;
    }

    await this.client.chat.postMessage({
      channel: channelId,
      text: message,
      unfurl_links: false,
    });
  }

  async getAllUsers(): Promise<{ id: string; email: string | undefined }[]> {
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

  async sendReminder(slackUserId: string): Promise<void> {
    await this.client.chat.postMessage({
      channel: slackUserId,
      text: "⏰ *Reminder:* You haven't submitted your daily status yet. Use `/daily` to submit your focus for today!",
    });

    logger.info({ slackUserId }, "Sent reminder");
  }
}

export const slackService = new SlackService();
