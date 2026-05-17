import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { JWT_STRATEGY_NAME } from 'src/google/google.constants';
import { IJwtSignData } from 'src/utils';
import { UserService } from './user.service';

@Controller('me')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @UseGuards(AuthGuard(JWT_STRATEGY_NAME))
  getMe(@Req() req: Request) {
    const { sub } = req.user as IJwtSignData;
    return this.userService.getProfile(sub);
  }
}
