import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { CalendarService } from 'src/calendar/calendar.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { CalendarScheduleService } from '../calendar.schedule';
import type {
  IGetCurrentScheduleProps,
  IUpdateProgressProps,
} from './interface';

@Injectable()
export class UpdateProgressService {
  constructor(
    private readonly openai: OpenAI,
    private readonly prisma: PrismaService,
    private readonly calendarService: CalendarService,
    private readonly calendarScheduleService: CalendarScheduleService,
  ) {}

  async getCurrentSchedule({ userId }: IGetCurrentScheduleProps) {
    return this.calendarScheduleService.getCurrentSchedule({ userId });
  }

  updateProgress({ userId, data }: IUpdateProgressProps) {
    return { userId, data };
  }
}
