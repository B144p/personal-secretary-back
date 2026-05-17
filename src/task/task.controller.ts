import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { DevOnlyGuard } from 'src/common/guards/dev-only.guard';
import { JWT_STRATEGY_NAME } from 'src/google/google.constants';
import { validateJwtPayload } from 'src/utils';
import { TaskService } from './task.service';

@Controller('task')
@UseGuards(AuthGuard(JWT_STRATEGY_NAME), DevOnlyGuard)
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Get('calendar/list')
  getCalendarList(@Req() req: Request) {
    return this.taskService.getCalendarList(validateJwtPayload(req.user).sub);
  }

  @Post('calendar/categorize')
  categorizeCalendarEvent() {
    return this.taskService.categorizeCalendarEvent();
  }

  @Post('openAI')
  classifyRules() {
    return this.taskService.classifyRules();
  }

  @Post('calendar/generate_rule')
  generateCalendarRule() {
    return this.taskService.generateCalendarRule();
  }
}
