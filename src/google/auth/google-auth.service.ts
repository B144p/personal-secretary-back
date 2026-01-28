import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { IJwtSignData } from 'src/utils';
import { GOOGLE_AUTH_REDIRECT_URI } from '../google.constants';
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
        avartarUrl: profileUrl,
        refresh_token: refreshToken || undefined,
      },
      create: {
        google_id: googleId,
        name,
        email,
        avartarUrl: profileUrl,
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

  async userDelete(refresh_token: string): Promise<unknown> {
    const client = CreateOAuthClient(GOOGLE_AUTH_REDIRECT_URI);
    client.setCredentials({ refresh_token });
    const profile = await getGoogleProfile(client);

    if (!profile.id) throw new Error('Profile not found');

    await client.revokeToken(refresh_token);
    await this.prisma.user.delete({
      where: { google_id: profile.id },
    });
    return 'User already deleted';
  }
}
