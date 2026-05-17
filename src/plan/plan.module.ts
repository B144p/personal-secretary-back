import { Module } from '@nestjs/common';
import OpenAI from 'openai';
import { CalendarModule } from 'src/calendar/calendar.module';
import { UserModule } from 'src/user/user.module';
import { CalendarScheduleService } from './calendar.schedule';
import { PlanController, PlanProgressController } from './plan.controller';
import { GeneratePlanService } from './plan.generate';
import { PlanService } from './plan.service';
import { UpdateProgressService } from './update.progress';

@Module({
  imports: [UserModule, CalendarModule],
  controllers: [PlanController, PlanProgressController],
  providers: [
    PlanService,
    OpenAI,
    CalendarScheduleService,
    GeneratePlanService,
    UpdateProgressService,
  ],
})
export class PlanModule {}
