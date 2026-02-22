import { Injectable } from '@nestjs/common';
import { CalendarService } from 'src/calendar/calendar.service';
import { categorizeMockup } from 'src/calendar/mocks';
import { OpenAIService } from 'src/openai/openai.service';
import { GenerateTaskDto } from './dto/create-task.dto';
import { mapToGoogleCalendar } from './utils';

@Injectable()
export class TaskService {
  constructor(
    private readonly openAIService: OpenAIService,
    private readonly calendarService: CalendarService,
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

  getCalendarList(id: string) {
    return this.calendarService.getCalendarList(id);
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
