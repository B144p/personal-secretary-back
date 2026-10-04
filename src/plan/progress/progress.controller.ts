import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApprovedGuard } from 'src/common/guards/approved.guard';
import { JwtOrPatGuard } from 'src/common/guards/jwt-or-pat.guard';
import { validateJwtPayload } from 'src/utils';
import { ProgressService } from './progress.service';

@Controller('progress')
@UseGuards(JwtOrPatGuard, ApprovedGuard)
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  // Every plan not DONE (?include_done=true for all), most recent first.
  @Get()
  async list(@Req() req: Request, @Query('include_done') includeDone?: string) {
    return await this.progressService.list(
      validateJwtPayload(req.user).sub,
      includeDone === 'true',
    );
  }
}
