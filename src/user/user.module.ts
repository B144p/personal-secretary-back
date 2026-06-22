import { Module } from '@nestjs/common';
import { CryptoModule } from 'src/crypto/crypto.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [CryptoModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
