import { DailyStatus, IDailyStatus, ISelectedTicket } from "../models";
import { logger } from "../config/logger";

class HistoryService {
  private getStartOfDay(date: Date): Date {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  private getPreviousWorkday(date: Date): Date {
    const prev = new Date(date);
    prev.setDate(prev.getDate() - 1);

    // Skip weekends
    while (prev.getDay() === 0 || prev.getDay() === 6) {
      prev.setDate(prev.getDate() - 1);
    }

    return this.getStartOfDay(prev);
  }

  async getYesterdayStatus(slackUserId: string): Promise<IDailyStatus | null> {
    const yesterday = this.getPreviousWorkday(new Date());

    return DailyStatus.findOne({
      slackUserId,
      date: yesterday,
    });
  }

  async getTodayStatus(slackUserId: string): Promise<IDailyStatus | null> {
    const today = this.getStartOfDay(new Date());

    return DailyStatus.findOne({
      slackUserId,
      date: today,
    });
  }

  async saveDailyStatus(
    slackUserId: string,
    linearUserId: string,
    selectedTickets: ISelectedTicket[],
    notes?: string,
    blockers?: string
  ): Promise<IDailyStatus> {
    const today = this.getStartOfDay(new Date());

    logger.info({ slackUserId, ticketCount: selectedTickets.length, hasNotes: !!notes }, "Saving daily status");

    return DailyStatus.findOneAndUpdate(
      { slackUserId, date: today },
      {
        slackUserId,
        linearUserId,
        date: today,
        selectedTickets,
        notes: notes || "",
        blockers: blockers || "",
        skipped: false,
        skipReason: "",
        submittedAt: new Date(),
      },
      { upsert: true, new: true }
    );
  }

  async saveSkip(
    slackUserId: string,
    linearUserId: string,
    reason: string
  ): Promise<IDailyStatus> {
    const today = this.getStartOfDay(new Date());

    logger.info({ slackUserId, reason }, "Saving skip status");

    return DailyStatus.findOneAndUpdate(
      { slackUserId, date: today },
      {
        slackUserId,
        linearUserId,
        date: today,
        selectedTickets: [],
        notes: "",
        blockers: "",
        skipped: true,
        skipReason: reason,
        submittedAt: new Date(),
      },
      { upsert: true, new: true }
    );
  }

  async getStatusHistory(
    slackUserId: string,
    days: number = 7
  ): Promise<IDailyStatus[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return DailyStatus.find({
      slackUserId,
      date: { $gte: this.getStartOfDay(startDate) },
    }).sort({ date: -1 });
  }

  async getPendingUsers(enabledSlackUserIds: string[]): Promise<string[]> {
    const today = this.getStartOfDay(new Date());
    
    const submittedToday = await DailyStatus.find({
      date: today,
      slackUserId: { $in: enabledSlackUserIds },
    }).select("slackUserId");

    const submittedIds = new Set(submittedToday.map((s) => s.slackUserId));
    
    return enabledSlackUserIds.filter((id) => !submittedIds.has(id));
  }
}

export const historyService = new HistoryService();
