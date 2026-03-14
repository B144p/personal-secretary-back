import { Injectable } from '@nestjs/common';
import { OpenAIService } from 'src/openai/openai.service';
import { GeneratePlanDto } from './dto/generate-plan.dto';
import { ReGeneratePlanDto } from './dto/re-generate-plan.dto';

@Injectable()
export class PlanService {
  constructor(private readonly openAIService: OpenAIService) {}

  async generate(generatePlanDto: GeneratePlanDto) {
    const generatePlanResponse =
      await this.openAIService.generatePlan(generatePlanDto);

    return generatePlanResponse;
  }

  reGenerate(reGeneratePlanDto: ReGeneratePlanDto) {
    return {
      message: 're-generate plan',
      ...reGeneratePlanDto,
    };
  }

  planAction(id: number, action: 'approve' | 'pause' | 'schedule') {
    return `Trigger ${action} on #${id} plan`;
  }

  remove(id: number) {
    return `This action removes a #${id} plan`;
  }
}
