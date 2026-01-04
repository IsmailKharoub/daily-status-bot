import { DailyStatus, IDailyStatus, ISelectedTicket } from "../models";

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

  async saveDailyStatus(
    slackUserId: string,
    linearUserId: string,
    selectedTickets: ISelectedTicket[]
  ): Promise<IDailyStatus> {
    const today = this.getStartOfDay(new Date());

    return DailyStatus.findOneAndUpdate(
      { slackUserId, date: today },
      {
        slackUserId,
        linearUserId,
        date: today,
        selectedTickets,
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
}

export const historyService = new HistoryService();

