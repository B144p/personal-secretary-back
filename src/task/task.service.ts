import { Injectable } from '@nestjs/common';
import { CalendarService } from 'src/calendar/calendar.service';
import { NotionService } from 'src/notion/notion.service';
import { OpenAIService } from 'src/openai/openai.service';
import { GenerateTaskDto } from './dto/create-task.dto';
import { mapToGoogleCalendar, mapToNotionPages } from './utils';

@Injectable()
export class TaskService {
  constructor(
    private readonly openAIService: OpenAIService,
    private readonly calendarService: CalendarService,
    private readonly notionService: NotionService,
  ) {}

  async generate(generateTaskDto: GenerateTaskDto) {
    const generatePlanResponse = await this.openAIService.generatePlan(
      generateTaskDto.goal,
    );
    const startDate = new Date(); // [TEMP] need to get from payload instead
    const calendarEvent = mapToGoogleCalendar(generatePlanResponse, startDate);
    const notionEvent = mapToNotionPages(generatePlanResponse);
    await Promise.all([
      this.calendarService.insertEvents(calendarEvent),
      this.notionService.insertPages(notionEvent),
    ]);

    return generatePlanResponse;
  }
}
