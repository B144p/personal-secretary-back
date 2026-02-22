import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { JWT_STRATEGY_NAME } from 'src/google/google.constants';
import { validateJwtPayload } from 'src/utils';
import { GenerateTaskDto } from './dto/create-task.dto';
import { TaskService } from './task.service';

@Controller('task')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Post('generate')
  generate(@Body() generateTaskDto: GenerateTaskDto) {
    return this.taskService.generate(generateTaskDto);
  }

  // TODO: Remove when feature done
  // ================== Open endpoint for test only (START) ==================
  @Get('calendar/list')
  @UseGuards(AuthGuard(JWT_STRATEGY_NAME))
  getCalendarList(@Req() req: Request) {
    return this.taskService.getCalendarList(validateJwtPayload(req.user).sub);
  }

  @Post('calendar/categorize')
  @UseGuards(AuthGuard(JWT_STRATEGY_NAME))
  categorizeCalendarEvent() {
    return this.taskService.categorizeCalendarEvent();
  }

  @Post('openAI')
  @UseGuards(AuthGuard(JWT_STRATEGY_NAME))
  classifyRules() {
    return this.taskService.classifyRules();
  }

  // ================== Open endpoint for test only (END) ==================
  @Post('calendar/generate_rule')
  @UseGuards(AuthGuard(JWT_STRATEGY_NAME))
  generateCalendarRule() {
    return this.taskService.generateCalendarRule();
  }
}
