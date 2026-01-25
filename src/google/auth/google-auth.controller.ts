import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';
import {
  GOOGLE_AUTH_CALLBACK_PATH,
  GOOGLE_AUTH_PREFIX,
  GOOGLE_LOGIN_SUCCESS_URL,
  GOOGLE_STRATEGY_NAME,
} from '../google.constants';
import { GoogleAuthService } from './google-auth.service';
import { IGoogleValidateUser } from './strategies/google.strategy';

@Controller(GOOGLE_AUTH_PREFIX)
export class GoogleAuthController {
  constructor(private readonly googleAuthService: GoogleAuthService) {}

  @Get()
  @UseGuards(AuthGuard(GOOGLE_STRATEGY_NAME))
  generateAuthUrlPassport() {}

  @Get(GOOGLE_AUTH_CALLBACK_PATH)
  @UseGuards(AuthGuard(GOOGLE_STRATEGY_NAME))
  async authCallbackPassport(@Req() req: Request, @Res() res: Response) {
    const jwt = await this.googleAuthService.loginWithGoogle(
      req.user as IGoogleValidateUser,
    );

    return res.redirect(`${GOOGLE_LOGIN_SUCCESS_URL}?token=${jwt}`);
  }

  @Post('delete')
  deleteUser(@Body() body: { refresh_token: string }) {
    return this.googleAuthService.userDelete(body.refresh_token);
  }
}
