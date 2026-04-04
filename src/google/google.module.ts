import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { getRequiredEnv } from 'src/utils';
import { GoogleAuthController } from './auth/google-auth.controller';
import { GoogleAuthService } from './auth/google-auth.service';
import { GoogleStrategy } from './auth/strategies/google.strategy';
import { JwtStrategy } from './auth/strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: getRequiredEnv('JWT_SECRET_KEY'),
        signOptions: { expiresIn: '3hr' },
      }),
    }),
  ],
  controllers: [GoogleAuthController],
  providers: [GoogleAuthService, GoogleStrategy, JwtStrategy],
  exports: [GoogleAuthService],
})
export class GoogleModule {}
