import { Injectable } from '@nestjs/common';
import { CalendarService } from 'src/calendar/calendar.service';
import { NotionService } from 'src/notion/notion.service';
import { OpenAIService } from 'src/openai/openai.service';
import { GenerateTaskDto } from './dto/create-task.dto';
import { mapToGoogleCalendar, mapToNotionPages } from './utils';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class TaskService {
  constructor(
    private readonly openAIService: OpenAIService,
    private readonly calendarService: CalendarService,
    private readonly notionService: NotionService,
    private readonly prisma: PrismaService,
  ) {}

  async generate(generateTaskDto: GenerateTaskDto) {
    const generatePlanResponse = await this.openAIService.generatePlan(
      generateTaskDto.goal,
    );
    const startDate = new Date(); // [TEMP] need to get from payload instead
    const calendarEvent = mapToGoogleCalendar(generatePlanResponse, startDate);
    const notionEvent = mapToNotionPages(generatePlanResponse);
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
}
