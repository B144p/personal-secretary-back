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
import { DevOnlyGuard } from 'src/common/guards/dev-only.guard';
import {
  GOOGLE_AUTH_CALLBACK_PATH,
  GOOGLE_AUTH_PREFIX,
  GOOGLE_STRATEGY_NAME,
} from '../google.constants';
import { GoogleAuthService } from './google-auth.service';
import { IGoogleValidateUser } from './strategies/google.strategy';

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://localhost:3001';
const JWT_COOKIE_NAME = 'jwt';
const JWT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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

    res.cookie(JWT_COOKIE_NAME, jwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: JWT_MAX_AGE_MS,
    });

    return res.redirect(`${FRONTEND_ORIGIN}/plans`);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(JWT_COOKIE_NAME);
  }

  @Post('delete')
  @UseGuards(DevOnlyGuard)
  deleteUser(@Req() req: Request & { body: { refresh_token: string } }) {
    return this.googleAuthService.userDelete(
      (req.body as { refresh_token: string }).refresh_token,
    );
  }
}
