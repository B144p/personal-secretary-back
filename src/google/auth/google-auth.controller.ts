import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
  GOOGLE_STRATEGY_NAME,
} from '../google.constants';
import { GoogleAuthService } from './google-auth.service';
import { IGoogleValidateUser } from './strategies/google.strategy';

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://localhost:3001';
const JWT_COOKIE_NAME = 'jwt';

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

    return res.redirect(`${FRONTEND_ORIGIN}/auth/callback?token=${jwt}`);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(JWT_COOKIE_NAME);
  }
}
