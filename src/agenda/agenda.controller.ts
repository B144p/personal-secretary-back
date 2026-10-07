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
import { agendaQuerySchema } from './agenda.dto';
import { AgendaService } from './agenda.service';

@Controller('agenda')
@UseGuards(JwtOrPatGuard, ApprovedGuard)
export class AgendaController {
  constructor(private readonly agendaService: AgendaService) {}

  // GET /agenda?date=YYYY-MM-DD&days=1..7 (get_today, the Chief's briefs).
  @Get()
  async getAgenda(@Req() req: Request, @Query() query: unknown) {
    const parsed = agendaQuerySchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues[0]?.message);
    return await this.agendaService.getAgenda(
      validateJwtPayload(req.user).sub,
      parsed.data,
    );
  }
}
