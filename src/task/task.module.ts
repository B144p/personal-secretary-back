import { Module } from '@nestjs/common';
import { TaskService } from './task.service';
import { TaskController } from './task.controller';
import { CalendarModule } from 'src/calendar/calendar.module';
import { NotionModule } from 'src/notion/notion.module';

@Module({
  imports: [CalendarModule, NotionModule],
  controllers: [TaskController],
  providers: [TaskService],
})
export class TaskModule {}
