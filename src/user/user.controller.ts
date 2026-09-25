import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApprovedGuard } from 'src/common/guards/approved.guard';
import { JwtOrPatGuard } from 'src/common/guards/jwt-or-pat.guard';
import { IJwtSignData } from 'src/utils';
import { UserService } from './user.service';

@Controller('me')
@UseGuards(JwtOrPatGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  // PENDING/REJECTED users must be able to read their own status — no ApprovedGuard here
  @Get()
  getMe(@Req() req: Request) {
    const { sub } = req.user as IJwtSignData;
    return this.userService.getProfile(sub);
  }

  @Get('settings')
  @UseGuards(ApprovedGuard)
  getSettings(@Req() req: Request) {
    const { sub } = req.user as IJwtSignData;
    return this.userService.getSettings(sub);
  }

  @Put('settings')
  @UseGuards(ApprovedGuard)
  updateSettings(@Req() req: Request, @Body() body: unknown) {
    const { sub } = req.user as IJwtSignData;
    return this.userService.updateSettings(sub, body);
  }

  @Get('ai-settings')
  @UseGuards(ApprovedGuard)
  getAiSettings(@Req() req: Request) {
    const { sub } = req.user as IJwtSignData;
    return this.userService.getAiSettings(sub);
  }

  @Put('ai-settings/models')
  @UseGuards(ApprovedGuard)
  updateAiModels(@Req() req: Request, @Body() body: unknown) {
    const { sub } = req.user as IJwtSignData;
    return this.userService.updateAiModels(sub, body);
  }

  @Put('ai-settings/api-key')
  @UseGuards(ApprovedGuard)
  updateApiKey(@Req() req: Request, @Body() body: unknown) {
    const { sub } = req.user as IJwtSignData;
    return this.userService.updateApiKey(sub, body);
  }
}
