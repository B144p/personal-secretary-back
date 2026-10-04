import { Module } from '@nestjs/common';
import { CalendarModule } from 'src/calendar/calendar.module';
import { UserModule } from 'src/user/user.module';
import { AgendaController } from './agenda.controller';
import { AgendaService } from './agenda.service';

@Module({
  imports: [UserModule, CalendarModule],
  controllers: [AgendaController],
  providers: [AgendaService],
})
export class AgendaModule {}
