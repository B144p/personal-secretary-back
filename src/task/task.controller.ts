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

  @Get('calendar/list')
  @UseGuards(AuthGuard(JWT_STRATEGY_NAME))
  getCalendarList(@Req() req: Request) {
    return this.taskService.getCalendarList(validateJwtPayload(req.user).sub);
  }
}
