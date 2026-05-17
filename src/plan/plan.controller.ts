import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { JWT_STRATEGY_NAME } from 'src/google/google.constants';
import { validateJwtPayload } from 'src/utils';
import { GeneratePlanDto } from './dto/generate-plan.dto';
import { ReGeneratePlanDto } from './dto/re-generate-plan.dto';
import { IPlanActionMode } from './interfaces';
import { PlanService } from './plan.service';
import { UpdateProgressService } from './update.progress';

@Controller('plan')
@UseGuards(AuthGuard(JWT_STRATEGY_NAME))
export class PlanController {
  constructor(private readonly planService: PlanService) {}

  @Throttle({ default: { ttl: 3600000, limit: 10 } })
  @Post('generate')
  async generate(
    @Req() req: Request,
    @Body() generatePlanDto: GeneratePlanDto,
  ) {
    return await this.planService.generate({
      userId: validateJwtPayload(req.user).sub,
      prompt: generatePlanDto,
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

  @Get()
  async getList(@Req() req: Request) {
    return await this.planService.getList({
      userId: validateJwtPayload(req.user).sub,
    });
  }

  @Get(':id')
  async getDetail(@Req() req: Request, @Param('id') id: string) {
    return await this.planService.getDetail({
      userId: validateJwtPayload(req.user).sub,
      id,
    });
  }

  @Throttle({ default: { ttl: 3600000, limit: 10 } })
  @Post(':id/re_generate')
  reGenerate(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() reGeneratePlanDto: ReGeneratePlanDto,
  ) {
    return this.planService.reGenerate({
      userId: validateJwtPayload(req.user).sub,
      data: {
        ...reGeneratePlanDto,
        id,
      },
    });
  }

  @Patch(':id/schedule')
  taskSchedule(@Req() req: Request, @Param('id') id: string) {
    return this.planService.generateAndApplyTaskSchedule({
      userId: validateJwtPayload(req.user).sub,
      id,
    });
  }

  @Patch(':id/:mode')
  planAction(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('mode') mode: IPlanActionMode,
  ) {
    return this.planService.planAction({
      id,
      mode,
      userId: validateJwtPayload(req.user).sub,
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

@Controller('plan-progress')
@UseGuards(AuthGuard(JWT_STRATEGY_NAME))
export class PlanProgressController {
  constructor(private readonly updateProgressService: UpdateProgressService) {}

  @Get()
  async getCurrentSchedule(@Req() req: Request) {
    return await this.updateProgressService.getCurrentSchedule({
      userId: validateJwtPayload(req.user).sub,
    });
  }

  @Patch()
  taskSchedule(@Req() req: Request) {
    return this.updateProgressService.updateProgress({
      userId: validateJwtPayload(req.user).sub,
      data: {},
    });
  }
}
