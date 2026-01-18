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

  async googleLogin(code: string) {
    const { tokens, profile } = await this.exchangeCode(code);

    // Todo: using user exist instead => handle case token update
    // No need to concern about performance => this flow is not active frequently.

    if (tokens.refresh_token) {
      console.log('register user');
      return await this.registerUser({ tokens, profile });
    } else {
      console.log('update user info');
      return await this.updateUser(profile);
    }
  }

  async exchangeCode(code: string): Promise<IReturnExchangeCode> {
    const client = CreateOAuthClient(GOOGLE_AUTH_REDIRECT_URI);
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    const profile = await getGoogleProfile(client);

    return { tokens, profile };
  }

  async registerUser({ tokens, profile }: IReturnExchangeCode) {
    const { id, email, name, picture } = profile;

    if (!id || !email) {
      // Todo: maybe force consent for handle error
      return 'user not found';
    }

    return this.prisma.user.create({
      data: {
        google_id: id,
        email,
        refresh_token: tokens.refresh_token!,
        avartarUrl: picture || undefined,
        name: name || '',
      },
    });
  }

  async updateUser({
    id,
    email,
    name,
    picture,
  }: IReturnExchangeCode['profile']) {
    if (!id) return 'Profile not found';

    return this.prisma.user.update({
      where: {
        google_id: id,
      },
      data: {
        name,
        email: email || undefined,
        avartarUrl: picture,
      },
    });
  }

  async userDelete(refresh_token: string): Promise<unknown> {
    const client = CreateOAuthClient(GOOGLE_AUTH_REDIRECT_URI);
    client.setCredentials({ refresh_token });
    const profile = await getGoogleProfile(client);

    if (!profile.id) return 'Profile not found';

    await client.revokeToken(refresh_token);
    await this.prisma.user.delete({
      where: { google_id: profile.id },
    });
    return 'User already deleted';
  }
}

interface IReturnExchangeCode {
  tokens: OAuth2Client['credentials'];
  profile: IGoogleProfile;
}
