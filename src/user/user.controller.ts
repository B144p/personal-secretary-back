import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { JWT_STRATEGY_NAME } from 'src/google/google.constants';
import { IJwtSignData } from 'src/utils';
import { UserService } from './user.service';

@Controller('me')
@UseGuards(AuthGuard(JWT_STRATEGY_NAME))
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  getMe(@Req() req: Request) {
    const { sub } = req.user as IJwtSignData;
    return this.userService.getProfile(sub);
  }

  @Get('settings')
  getSettings(@Req() req: Request) {
    const { sub } = req.user as IJwtSignData;
    return this.userService.getSettings(sub);
  }

  @Put('settings')
  updateSettings(@Req() req: Request, @Body() body: unknown) {
    const { sub } = req.user as IJwtSignData;
    return this.userService.updateSettings(sub, body);
  }
}
