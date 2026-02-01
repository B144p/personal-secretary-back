import { Module } from '@nestjs/common';
import { CalendarModule } from 'src/calendar/calendar.module';
import { NotionModule } from 'src/notion/notion.module';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';

@Module({
  imports: [CalendarModule, NotionModule],
  controllers: [TaskController],
  providers: [TaskService],
})
export class TaskModule {}
