import { Injectable, Logger } from '@nestjs/common';
import { CalendarService } from 'src/calendar/calendar.service';
import { categorizeMockup } from 'src/calendar/mocks';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly calendarService: CalendarService,
    private readonly prisma: PrismaService,
  ) {}

  // @Interval(1000 * 60)
  async syncUserCalendar() {
    const users = await this.prisma.user.findMany();
    for (const user of users) {
      const calendarList = await this.calendarService.getCalendarList(user.id);
      this.logger.log(
        `user_id: ${user.id}, name: ${user.name} | Update Sync: ${calendarList.count}`,
      );
    }
  }

  getCalendarList(userId: string) {
    return this.calendarService.getCalendarList(userId);
  }

  categorizeCalendarEvent() {
    return this.calendarService.classifyEvent(categorizeMockup.eventSummary);
  }

  classifyRules() {
    return this.calendarService.classifyRules();
  }

  generateCalendarRule() {
    return this.calendarService.generateCalendarRule();
  }
}
