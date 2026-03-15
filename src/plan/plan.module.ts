import { Module } from '@nestjs/common';
import { UserModule } from 'src/user/user.module';
import { PlanController } from './plan.controller';
import { PlanService } from './plan.service';

@Module({
  imports: [UserModule],
  controllers: [PlanController],
  providers: [PlanService],
})
export class PlanModule {}
