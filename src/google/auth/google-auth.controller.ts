import { Controller, Get, Query, Res } from '@nestjs/common';
import { GoogleAuthService } from './google-auth.service';
import { Response } from 'express';
import {
  GOOGLE_AUTH_PREFIX,
  GOOGLE_AUTH_CALLBACK_PATH,
  GOOGLE_LOGIN_SUCCESS_URL,
} from '../google.constants';

@Controller(GOOGLE_AUTH_PREFIX)
export class GoogleAuthController {
  constructor(private readonly googleAuthService: GoogleAuthService) {}

  @Get()
  generateAuthUrl(@Res() res: Response) {
    return res.redirect(this.googleAuthService.generateAuthUrl());
  }

  @Get(GOOGLE_AUTH_CALLBACK_PATH)
  async authCallback(@Query('code') code: string, @Res() res: Response) {
    console.log('code', code);
    const tokens = await this.googleAuthService.exchangeCode(code);
    console.log('tokens', tokens);

    // Todo: store token to db

    return res.redirect(GOOGLE_LOGIN_SUCCESS_URL);
  }
}
