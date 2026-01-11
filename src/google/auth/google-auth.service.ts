import { Injectable } from '@nestjs/common';
import { CreateOAuthClient } from './google-auth.client';
import { GOOGLE_AUTH_REDIRECT_URI } from '../google.constants';

@Injectable()
export class GoogleAuthService {
  constructor() {}

  generateAuthUrl() {
    const client = CreateOAuthClient(GOOGLE_AUTH_REDIRECT_URI);

    console.log('generatinh google auth url');

    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/calendar'],
    });
  }

  async exchangeCode(code: string): Promise<unknown> {
    const client = CreateOAuthClient(GOOGLE_AUTH_REDIRECT_URI);

    const { tokens } = await client.getToken(code);

    return tokens;
  }
}
