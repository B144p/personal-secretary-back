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
import { Request } from 'express';
import { JWT_STRATEGY_NAME } from 'src/google/google.constants';
import { validateJwtPayload } from 'src/utils';
import { GeneratePlanDto } from './dto/generate-plan.dto';
import { ReGeneratePlanDto } from './dto/re-generate-plan.dto';
import { IPlanActionMode } from './interfaces';
import { PlanService } from './plan.service';

@Controller('plan')
export class PlanController {
  constructor(private readonly planService: PlanService) {}

  @Post('generate')
  @UseGuards(AuthGuard(JWT_STRATEGY_NAME))
  async generate(
    @Req() req: Request,
    @Body() generatePlanDto: GeneratePlanDto,
  ) {
    return await this.planService.generate({
      userId: validateJwtPayload(req.user).sub,
      prompt: generatePlanDto,
    });
  }

  @Get()
  @UseGuards(AuthGuard(JWT_STRATEGY_NAME))
  async getList(@Req() req: Request) {
    return await this.planService.getList({
      userId: validateJwtPayload(req.user).sub,
    });
  }

  @Get(':id')
  @UseGuards(AuthGuard(JWT_STRATEGY_NAME))
  async getDetail(@Req() req: Request, @Param('id') id: string) {
    return await this.planService.getDetail({
      userId: validateJwtPayload(req.user).sub,
      id,
    });
  }

  @Post(':id/re_generate')
  @UseGuards(AuthGuard(JWT_STRATEGY_NAME))
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
  @UseGuards(AuthGuard(JWT_STRATEGY_NAME))
  planSchedule(@Param('id') id: string) {
    return `Schedule plan on #${id}`;
  }

  @Patch(':id/:mode')
  @UseGuards(AuthGuard(JWT_STRATEGY_NAME))
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
  remove(@Param('id') id: string) {
    return this.planService.remove(id);
  }
}
