import { Module } from '@nestjs/common';
import { CryptoModule } from 'src/crypto/crypto.module';
import { UserModule } from 'src/user/user.module';
import { CalendarService } from './calendar.service';

@Module({
  imports: [UserModule, CryptoModule],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
