import { Injectable } from '@nestjs/common';
import { CalendarClassifierService } from './calendar.classifier';
import {
  CalendarGeneratorService,
  IGenerateCalendarResponse,
} from './calendar.generate';
import { TaskGeneratorService } from './task.generate';

@Injectable()
export class OpenAIService {
  constructor(
    private readonly calendarClassifierService: CalendarClassifierService,
    private readonly calendarGenerator: CalendarGeneratorService,
    private readonly taskGeneratorService: TaskGeneratorService,
  ) {}

  async generatePlan(
    data: Parameters<typeof this.taskGeneratorService.generatePlan>[0],
  ) {
    return await this.taskGeneratorService.generatePlan(data);
  }

  async reGeneratePlan(
    data: Parameters<typeof this.taskGeneratorService.reGeneratePlan>[0],
  ) {
    return await this.taskGeneratorService.reGeneratePlan(data);
  }

  async classifyRules(summaries: string[]) {
    return await this.calendarClassifierService.classifyEvent(summaries);
  }

  async generateCategoryRules(): Promise<IGenerateCalendarResponse> {
    return await this.calendarGenerator.categoryRuleGenerator();
  }
}
