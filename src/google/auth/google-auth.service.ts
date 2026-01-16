import { Injectable } from '@nestjs/common';
import {
  CreateOAuthClient,
  getGoogleProfile,
  IGoogleProfile,
  OAuth2Client,
} from './google-auth.client';
import { GOOGLE_AUTH_REDIRECT_URI } from '../google.constants';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class GoogleAuthService {
  constructor(private readonly prisma: PrismaService) {}

  generateAuthUrl() {
    const client = CreateOAuthClient(GOOGLE_AUTH_REDIRECT_URI);

    return client.generateAuthUrl({
      access_type: 'offline',
      // prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/calendar', 'profile', 'email'],
    });
  }

  async exchangeCode(code: string): Promise<unknown> {
    const client = CreateOAuthClient(GOOGLE_AUTH_REDIRECT_URI);
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    const profile = await getGoogleProfile(client);

    // return await this.upsertGoogleUser(profile, tokens);
    return { tokens, profile };
  }

  upsertGoogleUser(
    profile: IGoogleProfile,
    tokens: OAuth2Client['credentials'],
  ): unknown {
    // Todo: store token to db

    return { tokens, profile };
  }

  async revokeToken(refresh_token: string): Promise<unknown> {
    const client = CreateOAuthClient(GOOGLE_AUTH_REDIRECT_URI);
    return await client.revokeToken(refresh_token);
  }

  async userDelete(tokens: string) {
    const revokeRes = await this.revokeToken(tokens);

    // Todo: remove user from db
    console.log('User already deleted');

    return revokeRes;
  }
}
