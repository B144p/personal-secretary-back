import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import {
  GOOGLE_AUTH_REDIRECT_URI,
  GOOGLE_STRATEGY_NAME,
} from 'src/google/google.constants';

@Injectable()
export class GoogleStrategy extends PassportStrategy(
  Strategy,
  GOOGLE_STRATEGY_NAME,
) {
  constructor() {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: GOOGLE_AUTH_REDIRECT_URI,
      scope: ['https://www.googleapis.com/auth/calendar', 'profile', 'email'],
    });
  }

  validate(
    _accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ) {
    const { id, emails, displayName, profileUrl } = profile;

    const user: IGoogleValidateUser = {
      googleId: id,
      email: emails?.[0].value,
      name: displayName,
      refreshToken,
      profileUrl,
    };

    done(null, user);
  }
}

export interface IGoogleValidateUser {
  googleId: string;
  email?: string;
  name?: string;
  refreshToken?: string;
  profileUrl?: string;
}
