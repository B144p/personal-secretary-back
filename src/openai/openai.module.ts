import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { UserModule } from 'src/user/user.module';
import { CalendarClassifierService } from './calendar.classifier';
import { CalendarGeneratorService } from './calendar.generate';
import { OpenAIService } from './openai.service';
import { TaskGeneratorService } from './task.generate';

@Global()
@Module({
  imports: [ConfigModule, UserModule],
  providers: [
    {
      provide: OpenAI,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        return new OpenAI({
          apiKey: configService.get<string>('OPENAI_API_KEY'),
        });
      },
    },
    OpenAIService,
    CalendarClassifierService,
    CalendarGeneratorService,
    TaskGeneratorService,
  ],
  exports: [OpenAIService],
})
export class OpenaiModule {}
