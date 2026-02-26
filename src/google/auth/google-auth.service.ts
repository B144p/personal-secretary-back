import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { IJwtSignData } from 'src/utils';
import { CreateOAuthClient, getGoogleProfile } from './google-auth.client';
import { IGoogleValidateUser } from './strategies/google.strategy';

@Injectable()
export class GoogleAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async loginWithGoogle(userDetail: IGoogleValidateUser) {
    const { googleId, email, name, refreshToken, profileUrl } = userDetail;
    if (!googleId || !email) {
      // Todo: maybe force consent for handle error
      throw new Error('user not found');
    }

    const user = await this.prisma.user.upsert({
      where: { google_id: googleId },
      update: {
        name,
        email,
        avartar_url: profileUrl,
        refresh_token: refreshToken || undefined,
      },
      create: {
        google_id: googleId,
        name,
        email,
        avartar_url: profileUrl,
        refresh_token: refreshToken || '',
      },
    });
    const jwt = this.googleSignJwt(user);

    return jwt;
  }

  googleSignJwt(user: User) {
    const jwtSignData: IJwtSignData = {
      sub: user.id,
      email: user.email,
    };
    return this.jwtService.sign(jwtSignData);
  }

  // TODO: Remove on production
  // ================== Flow for manual handling (without passport) (START) ==================
  manualGenerateAuthUrl() {
    const client = CreateOAuthClient();
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/calendar', 'profile', 'email'],
    });
  }

  async manualExchangeCode(code: string): Promise<unknown> {
    const client = CreateOAuthClient();
    const { tokens } = await client.getToken(code);

    return { tokens };
  }

  async userDelete(refresh_token: string): Promise<unknown> {
    const client = CreateOAuthClient();
    client.setCredentials({ refresh_token });
    const profile = await getGoogleProfile(client);

    if (!profile.id) throw new Error('Profile not found');

    await client.revokeToken(refresh_token);
    await this.prisma.user.delete({
      where: { google_id: profile.id },
    });
    return 'User already deleted';
  }

  // ================== Flow for manual handling (without passport) (END) ==================
}
