import { Module } from '@nestjs/common';
import { UserModule } from 'src/user/user.module';
import { CalendarService } from './calendar.service';

@Module({
  imports: [UserModule],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
