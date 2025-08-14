import { Body, Controller, Post } from '@nestjs/common';
import { GenerateTaskDto } from './dto/create-task.dto';
import { TaskService } from './task.service';

@Controller('task')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Post('generate')
  generate(@Body() generateTaskDto: GenerateTaskDto) {
    return this.taskService.generate(generateTaskDto);
  }
}
