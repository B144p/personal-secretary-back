import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { ApprovedGuard } from 'src/common/guards/approved.guard';
import { JwtOrPatGuard } from 'src/common/guards/jwt-or-pat.guard';
import { validateJwtPayload } from 'src/utils';
import { generatePlanSchema } from './dto/generate-plan.dto';
import { importPlanSchema } from './dto/import-plan.dto';
import { listPlansQuerySchema } from './dto/list-plans.dto';
import { reGeneratePlanSchema } from './dto/re-generate-plan.dto';
import {
  rescheduleSchema,
  updateProgressSchema,
} from './dto/update-progress.dto';
import { updateTaskStatusSchema } from './dto/update-task-status.dto';
import { PlanImportService } from './plan.import';
import { PlanService } from './plan.service';
import { PlanTaskStatusService } from './plan.status';
import { ProgressService } from './progress/progress.service';
import { UpdateProgressService } from './update.progress';

@Controller('plan')
@UseGuards(JwtOrPatGuard, ApprovedGuard)
export class PlanController {
  constructor(
    private readonly planService: PlanService,
    private readonly planImportService: PlanImportService,
    private readonly planTaskStatusService: PlanTaskStatusService,
    private readonly progressService: ProgressService,
  ) {}

  // Plan written by Claude Code in plan mode — no OpenAI, no calendar.
  @Throttle({ default: { ttl: 3600000, limit: 60 } })
  @Post('import')
  async import(@Req() req: Request, @Body() body: unknown) {
    const parsed = importPlanSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues[0]?.message);
    return await this.planImportService.importPlan(
      validateJwtPayload(req.user).sub,
      parsed.data,
    );
  }

  @Throttle({ default: { ttl: 3600000, limit: 10 } })
  @Post('generate')
  async generate(@Req() req: Request, @Body() body: unknown) {
    const parsed = generatePlanSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues[0]?.message);
    return await this.planService.generate({
      userId: validateJwtPayload(req.user).sub,
      prompt: parsed.data,
    });
  }

  @Get()
  async getList(@Req() req: Request, @Query() query: unknown) {
    const parsed = listPlansQuerySchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues[0]?.message);
    return await this.planService.getList({
      userId: validateJwtPayload(req.user).sub,
      query: parsed.data,
    });
  }

  // How one plan is going (agents, get_progress).
  @Get(':id/progress')
  async getProgress(@Req() req: Request, @Param('id') id: string) {
    return await this.progressService.one(validateJwtPayload(req.user).sub, id);
  }

  @Get(':id')
  async getDetail(@Req() req: Request, @Param('id') id: string) {
    return await this.planService.getDetail({
      userId: validateJwtPayload(req.user).sub,
      id,
    });
  }

  @Post(':planId/tasks')
  createTask(
    @Req() req: Request,
    @Param('planId') planId: string,
    @Body() body: unknown,
  ) {
    return this.planService.createTask({
      userId: validateJwtPayload(req.user).sub,
      planId,
      body,
    });
  }

  @Patch(':planId/tasks/:taskId')
  updateTask(
    @Req() req: Request,
    @Param('planId') planId: string,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ) {
    return this.planService.updateTask({
      userId: validateJwtPayload(req.user).sub,
      planId,
      taskId,
      body,
    });
  }

  // Status reported by Claude Code as it works (CLAUDE_CODE plans only).
  @Patch(':planId/tasks/:taskId/status')
  async updateTaskStatus(
    @Req() req: Request,
    @Param('planId') planId: string,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ) {
    const parsed = updateTaskStatusSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues[0]?.message);
    return await this.planTaskStatusService.updateStatus({
      userId: validateJwtPayload(req.user).sub,
      planId,
      taskId,
      dto: parsed.data,
    });
  }

  @Delete(':planId/tasks/:taskId')
  deleteTask(
    @Req() req: Request,
    @Param('planId') planId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.planService.deleteTask({
      userId: validateJwtPayload(req.user).sub,
      planId,
      taskId,
    });
  }

  @Throttle({ default: { ttl: 3600000, limit: 10 } })
  @Post(':id/re_generate')
  reGenerate(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = reGeneratePlanSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues[0]?.message);
    return this.planService.reGenerate({
      userId: validateJwtPayload(req.user).sub,
      data: { ...parsed.data, id },
    });
  }

  @Patch(':id/schedule')
  taskSchedule(@Req() req: Request, @Param('id') id: string) {
    return this.planService.generateAndApplyTaskSchedule({
      userId: validateJwtPayload(req.user).sub,
      id,
    });
  }

  @Patch(':id/pause')
  pause(@Req() req: Request, @Param('id') id: string) {
    return this.planService.pause({
      userId: validateJwtPayload(req.user).sub,
      id,
    });
  }

  @Patch(':id/resume')
  resume(@Req() req: Request, @Param('id') id: string) {
    return this.planService.resume({
      userId: validateJwtPayload(req.user).sub,
      id,
    });
  }

  @Patch(':id/transition')
  transition(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { to: string },
  ) {
    return this.planService.transition({
      userId: validateJwtPayload(req.user).sub,
      id,
      to: body.to,
    });
  }

  @Patch(':id/schedule/remove')
  async removeRelatedCalendarEvent(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return await this.planService.removeRelatedCalendarEvent({
      userId: validateJwtPayload(req.user).sub,
      planId: id,
    });
  }

  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    return this.planService.remove({
      id,
      userId: validateJwtPayload(req.user).sub,
    });
  }
}

// Also used by agents (Chief of Staff, Go runner) with a personal access token.
@Controller('plan-progress')
@UseGuards(JwtOrPatGuard, ApprovedGuard)
export class PlanProgressController {
  constructor(private readonly updateProgressService: UpdateProgressService) {}

  @Get()
  async getCurrentSchedule(@Req() req: Request) {
    return await this.updateProgressService.getCurrentSchedule({
      userId: validateJwtPayload(req.user).sub,
    });
  }

  @Patch()
  updateProgress(@Req() req: Request, @Body() body: unknown) {
    const parsed = updateProgressSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues[0]?.message);
    return this.updateProgressService.updateProgress({
      userId: validateJwtPayload(req.user).sub,
      data: parsed.data,
    });
  }

  // Repack slipped and remaining steps of the scheduled plan, no status change.
  @Post('reschedule')
  reschedule(@Req() req: Request, @Body() body: unknown) {
    const parsed = rescheduleSchema.safeParse(body ?? {});
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues[0]?.message);
    return this.updateProgressService.reschedule({
      userId: validateJwtPayload(req.user).sub,
      note: parsed.data.note,
    });
  }
}
