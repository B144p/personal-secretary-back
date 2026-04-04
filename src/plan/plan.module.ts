import { Module } from '@nestjs/common';
import OpenAI from 'openai';
import { CalendarModule } from 'src/calendar/calendar.module';
import { UserModule } from 'src/user/user.module';
import { CalendarScheduleService } from './calendar.schedule';
import { PlanController } from './plan.controller';
import { GeneratePlanService } from './plan.generate';
import { PlanService } from './plan.service';

@Module({
  imports: [UserModule, CalendarModule],
  controllers: [PlanController],
  providers: [
    PlanService,
    OpenAI,
    CalendarScheduleService,
    GeneratePlanService,
  ],
})
export class PlanModule {}
