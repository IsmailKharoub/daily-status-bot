import { EnabledUser, IEnabledUser } from "../models";
import { linearService } from "./linear.service";
import { slackService } from "./slack.service";

class UserService {
  // Get only enabled users with their Linear/Slack IDs
  async getEnabledUsers(): Promise<Map<string, string>> {
    const enabledUsers = await EnabledUser.find({ enabled: true });
    const mapping = new Map<string, string>();

    for (const user of enabledUsers) {
      if (user.linearUserId && user.slackUserId) {
        mapping.set(user.linearUserId, user.slackUserId);
      }
    }

    console.log(`Found ${mapping.size} enabled users`);
    return mapping;
  }

  // Add a user by email - looks up their Linear/Slack IDs
  async addUser(email: string): Promise<IEnabledUser> {
    const normalizedEmail = email.toLowerCase();

    // Check if already exists
    const existing = await EnabledUser.findOne({ email: normalizedEmail });
    if (existing) {
      throw new Error(`User ${email} already exists`);
    }

    // Look up Linear user
    const linearUsers = await linearService.getAllUsers();
    const linearUser = linearUsers.find(
      (u) => u.email?.toLowerCase() === normalizedEmail
    );

    // Look up Slack user
    const slackUsers = await slackService.getAllUsers();
    const slackUser = slackUsers.find(
      (u) => u.email?.toLowerCase() === normalizedEmail
    );

    const enabledUser = await EnabledUser.create({
      email: normalizedEmail,
      linearUserId: linearUser?.id ?? null,
      slackUserId: slackUser?.id ?? null,
      enabled: true,
    });

    return enabledUser;
  }

  // Remove a user by email
  async removeUser(email: string): Promise<boolean> {
    const result = await EnabledUser.deleteOne({ email: email.toLowerCase() });
    return result.deletedCount > 0;
  }

  // Enable/disable a user
  async setUserEnabled(email: string, enabled: boolean): Promise<IEnabledUser | null> {
    return EnabledUser.findOneAndUpdate(
      { email: email.toLowerCase() },
      { enabled },
      { new: true }
    );
  }

  // List all users (enabled and disabled)
  async listUsers(): Promise<IEnabledUser[]> {
    return EnabledUser.find().sort({ createdAt: -1 });
  }

  // Refresh a user's Linear/Slack IDs (if they were missing)
  async refreshUser(email: string): Promise<IEnabledUser | null> {
    const normalizedEmail = email.toLowerCase();
    const user = await EnabledUser.findOne({ email: normalizedEmail });
    if (!user) return null;

    const [linearUsers, slackUsers] = await Promise.all([
      linearService.getAllUsers(),
      slackService.getAllUsers(),
    ]);

    const linearUser = linearUsers.find(
      (u) => u.email?.toLowerCase() === normalizedEmail
    );
    const slackUser = slackUsers.find(
      (u) => u.email?.toLowerCase() === normalizedEmail
    );

    user.linearUserId = linearUser?.id ?? null;
    user.slackUserId = slackUser?.id ?? null;
    await user.save();

    return user;
  }

  // Get Linear user ID by Slack ID (for interaction handling)
  async getLinearUserIdBySlackId(slackUserId: string): Promise<string | null> {
    const user = await EnabledUser.findOne({ slackUserId, enabled: true });
    return user?.linearUserId ?? null;
  }
}

export const userService = new UserService();
