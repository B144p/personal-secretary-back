import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { CalendarClassifierService } from './calendar.classifier';
import {
  CalendarGeneratorService,
  IGenerateCalendarResponse,
} from './calendar.generate';
import { generateTask } from './task.generate';

@Injectable()
export class OpenAIService {
  constructor(
    private readonly openai: OpenAI,
    private readonly calendarClassifierService: CalendarClassifierService,
    private readonly calendarGenerator: CalendarGeneratorService,
  ) {}

  async generatePlan(prompt: string) {
    return await generateTask({
      client: this.openai,
      prompt,
    });
  }

  async classifyRules(summaries: string[]) {
    return await this.calendarClassifierService.classifyEvent(summaries);
  }

  async generateCategoryRules(): Promise<IGenerateCalendarResponse> {
    return await this.calendarGenerator.categoryRuleGenerator();
  }
}
