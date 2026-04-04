import { Injectable } from '@nestjs/common';
import { CalendarClassifierService } from './calendar.classifier';
import {
  CalendarGeneratorService,
  IGenerateCalendarResponse,
} from './calendar.generate';

// Problem found: import module to each other => need forwardRef
// TODO: refactor it to pure infra. => move each business logic to own module => add layer for orchestrate it instead
@Injectable()
export class OpenAIService {
  constructor(
    private readonly calendarClassifierService: CalendarClassifierService,
    private readonly calendarGenerator: CalendarGeneratorService,
  ) {}

  async classifyRules(summaries: string[]) {
    return await this.calendarClassifierService.classifyEvent(summaries);
  }

  async generateCategoryRules(): Promise<IGenerateCalendarResponse> {
    return await this.calendarGenerator.categoryRuleGenerator();
  }
}
