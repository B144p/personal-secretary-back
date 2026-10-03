import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { ApprovedGuard } from 'src/common/guards/approved.guard';
import { JwtOrPatGuard } from 'src/common/guards/jwt-or-pat.guard';
import { validateJwtPayload } from 'src/utils';
import { repoContextQuerySchema } from './context.dto';
import { ContextService } from './context.service';

@Controller('context')
@UseGuards(JwtOrPatGuard, ApprovedGuard)
export class ContextController {
  constructor(private readonly contextService: ContextService) {}

  // Called by the SessionStart hook and the get_repo_context MCP tool.
  @Get()
  async getRepoContext(@Req() req: Request, @Query() query: unknown) {
    const parsed = repoContextQuerySchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues[0]?.message);
    return await this.contextService.getRepoContext(
      validateJwtPayload(req.user).sub,
      parsed.data,
    );
  }
}
