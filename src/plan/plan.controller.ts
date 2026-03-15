import {
  Body,
  Controller,
  Delete,
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

  @Post('re_generate')
  reGenerate(@Body() reGeneratePlanDto: ReGeneratePlanDto) {
    return this.planService.reGenerate(reGeneratePlanDto);
  }

  @Patch(':id/:action')
  @UseGuards(AuthGuard(JWT_STRATEGY_NAME))
  planAction(
    @Param('id') id: string,
    @Param('action') action: 'approve' | 'pause' | 'schedule',
  ) {
    return this.planService.planAction(id, action);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.planService.remove(id);
  }
}
