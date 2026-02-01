import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JWT_STRATEGY_NAME } from 'src/google/google.constants';
import { getRequiredEnv, IJwtSignData } from 'src/utils';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, JWT_STRATEGY_NAME) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: getRequiredEnv('JWT_SECRET_KEY'),
    });
  }

  validate(payload: IJwtSignData) {
    return payload;
  }
}
