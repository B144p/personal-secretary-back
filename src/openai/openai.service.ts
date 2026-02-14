import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { categorizeMockup } from 'src/calendar/mocks';
import { CalendarClassifierService } from './calendar.classifier';
import { generateTask } from './task.generate';

@Injectable()
export class OpenAIService {
  constructor(
    private readonly openai: OpenAI,
    private readonly calendarClassifierService: CalendarClassifierService,
  ) {}

  async generatePlan(prompt: string) {
    return await generateTask({
      client: this.openai,
      prompt,
    });
  }

  async classifyRules() {
    return await this.calendarClassifierService.classifyEvent(
      categorizeMockup.eventSummary,
    );
  }
}
