import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CalendarService } from 'src/calendar/calendar.service';
import { categorizeMockup } from 'src/calendar/mocks';
import { OpenAIService } from 'src/openai/openai.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { GenerateTaskDto } from './dto/create-task.dto';
import { mapToGoogleCalendar } from './utils';

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly openAIService: OpenAIService,
    private readonly calendarService: CalendarService,
    private readonly prisma: PrismaService,
  ) {}

  async generate(generateTaskDto: GenerateTaskDto) {
    const generatePlanResponse = await this.openAIService.generatePlan(
      generateTaskDto.goal,
    );
    const startDate = new Date(); // [TEMP] need to get from payload instead
    const calendarEvent = mapToGoogleCalendar(generatePlanResponse, startDate);
    // const notionEvent = mapToNotionPages(generatePlanResponse);
    // await this.prisma.plan.create({
    //   data: {
    //     title: generatePlanResponse.goal,
    //     tasks: {
    //       create: generatePlanResponse.daily_tasks.map(
    //         ({ tasks: _, ...daily_task }) => ({
    //           ...daily_task,
    //         }),
    //       ),
    //     },
    //   },
    // });
    await Promise.all([
      this.calendarService.insertEvents(calendarEvent),
      // this.notionService.insertPages(notionEvent),
    ]);

    return generatePlanResponse;
  }

  @Interval(1000 * 60)
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
