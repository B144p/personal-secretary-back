import { Module } from '@nestjs/common';
import { CalendarModule } from 'src/calendar/calendar.module';
import { UserModule } from 'src/user/user.module';
import { CalendarScheduleService } from './calendar.schedule';
import { PlanController, PlanProgressController } from './plan.controller';
import { GeneratePlanService } from './plan.generate';
import { PlanImportService } from './plan.import';
import { PlanService } from './plan.service';
import { PlanTaskStatusService } from './plan.status';
import { StalePlansCron } from './stale-plans.cron';
import { UpdateProgressService } from './update.progress';

@Module({
  imports: [UserModule, CalendarModule],
  controllers: [PlanController, PlanProgressController],
  providers: [
    PlanService,
    CalendarScheduleService,
    GeneratePlanService,
    PlanImportService,
    PlanTaskStatusService,
    UpdateProgressService,
    StalePlansCron,
  ],
})
export class PlanModule {}
