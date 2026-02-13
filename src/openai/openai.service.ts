import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { categorizeMockup } from 'src/calendar/mocks';
import { classifyEventCategories } from './calendar.classifier';
import { generateTask } from './task.generate';

@Injectable()
export class OpenAIService {
  constructor(private readonly openai: OpenAI) {}

  async generatePlan(prompt: string) {
    return await generateTask({
      client: this.openai,
      prompt,
    });
  }

  async classifyRules() {
    return await classifyEventCategories({
      client: this.openai,
      summaries: categorizeMockup.eventSummary,
    });
  }
}
