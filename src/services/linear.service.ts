import { LinearClient, Issue } from "@linear/sdk";
import { env } from "../config/env";

export interface Ticket {
  id: string;
  identifier: string;
  title: string;
  status: string;
  url: string;
}

class LinearService {
  private _client: LinearClient | null = null;

  private get client(): LinearClient {
    if (!this._client) {
      this._client = new LinearClient({ apiKey: env.linearApiKey });
    }
    return this._client;
  }

  async getIncompleteTicketsForUser(userId: string): Promise<Ticket[]> {
    const issues = await this.client.issues({
      filter: {
        assignee: { id: { eq: userId } },
        state: { type: { nin: ["completed", "canceled"] } },
        cycle: { isActive: { eq: true } },
      },
    });

    return Promise.all(
      issues.nodes.map(async (issue) => {
        const state = await issue.state;
        return {
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          status: state?.name ?? "Unknown",
          url: issue.url,
        };
      })
    );
  }

  async getTicketById(ticketId: string): Promise<Ticket | null> {
    try {
      const issue = await this.client.issue(ticketId);
      const state = await issue.state;
      return {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        status: state?.name ?? "Unknown",
        url: issue.url,
      };
    } catch {
      return null;
    }
  }

  async getTicketsByIds(ticketIds: string[]): Promise<Ticket[]> {
    const tickets = await Promise.all(
      ticketIds.map((id) => this.getTicketById(id))
    );
    return tickets.filter((t): t is Ticket => t !== null);
  }

  async getAllUsers(): Promise<{ id: string; email: string | undefined }[]> {
    const users = await this.client.users();
    return users.nodes.map((user) => ({
      id: user.id,
      email: user.email,
    }));
  }
}

export const linearService = new LinearService();

