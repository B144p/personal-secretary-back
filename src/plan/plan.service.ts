import { Injectable } from '@nestjs/common';
import { OpenAIService } from 'src/openai/openai.service';
import { ReGeneratePlanDto } from './dto/re-generate-plan.dto';

@Injectable()
export class PlanService {
  constructor(private readonly openAIService: OpenAIService) {}

  async generate(data: Parameters<typeof this.openAIService.generatePlan>[0]) {
    return await this.openAIService.generatePlan(data);
  }

  reGenerate(reGeneratePlanDto: ReGeneratePlanDto) {
    return {
      message: 're-generate plan',
      ...reGeneratePlanDto,
    };
  }

  planAction(id: string, action: 'approve' | 'pause' | 'schedule') {
    return `Trigger ${action} on #${id} plan`;
  }

  remove(id: string) {
    return `This action removes a #${id} plan`;
  }
}
