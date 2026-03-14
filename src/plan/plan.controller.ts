import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { GeneratePlanDto } from './dto/generate-plan.dto';
import { ReGeneratePlanDto } from './dto/re-generate-plan.dto';
import { PlanService } from './plan.service';

@Controller('plan')
export class PlanController {
  constructor(private readonly planService: PlanService) {}

  @Post('generate')
  generate(@Body() generatePlanDto: GeneratePlanDto) {
    return this.planService.generate(generatePlanDto);
  }

  @Post('re_generate')
  reGenerate(@Body() reGeneratePlanDto: ReGeneratePlanDto) {
    return this.planService.reGenerate(reGeneratePlanDto);
  }

  @Patch(':id/:action')
  planAction(
    @Param('id') id: string,
    @Param('action') action: 'approve' | 'pause' | 'schedule',
  ) {
    return this.planService.planAction(+id, action);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.planService.remove(+id);
  }
}
