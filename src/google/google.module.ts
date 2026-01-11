import { Module } from '@nestjs/common';
import { GoogleAuthController } from './auth/google-auth.controller';
import { GoogleAuthService } from './auth/google-auth.service';

@Module({
  controllers: [GoogleAuthController],
  providers: [GoogleAuthService],
  exports: [GoogleAuthService],
})
export class GoogleModule {}
