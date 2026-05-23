import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { CryptoService } from 'src/crypto/crypto.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { IJwtSignData } from 'src/utils';
import { CreateOAuthClient, getGoogleProfile } from './google-auth.client';
import { IGoogleValidateUser } from './strategies/google.strategy';

@Injectable()
export class GoogleAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly crypto: CryptoService,
  ) {}

  async loginWithGoogle(userDetail: IGoogleValidateUser) {
    const { googleId, email, name, refreshToken, profileUrl } = userDetail;
    if (!googleId || !email) {
      throw new Error('user not found');
    }

    const encryptedToken = refreshToken
      ? this.crypto.encrypt(refreshToken)
      : undefined;

    const user = await this.prisma.user.upsert({
      where: { google_id: googleId },
      update: {
        name,
        email,
        avatar_url: profileUrl,
        // only overwrite if a fresh token arrived; preserve existing otherwise
        ...(encryptedToken && { refresh_token: encryptedToken }),
      },
      create: {
        google_id: googleId,
        name,
        email,
        avatar_url: profileUrl,
        refresh_token: encryptedToken ?? '',
        user_state: { create: {} },
      },
    });

    return this.googleSignJwt(user);
  }

  googleSignJwt(user: User) {
    const jwtSignData: IJwtSignData = { sub: user.id, email: user.email };
    return this.jwtService.sign(jwtSignData);
  }

  // TODO: Remove on production
  async userDelete(refresh_token: string): Promise<unknown> {
    const client = CreateOAuthClient();
    client.setCredentials({ refresh_token });
    const profile = await getGoogleProfile(client);

    if (!profile.id) throw new Error('Profile not found');

    await client.revokeToken(refresh_token);
    await this.prisma.user.delete({ where: { google_id: profile.id } });
    return 'User already deleted';
  }
}
