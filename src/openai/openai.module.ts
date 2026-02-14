import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { CalendarClassifierService } from './calendar.classifier';
import { OpenAIService } from './openai.service';

@Global()
@Module({
  imports: [ConfigModule],
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
  ],
  exports: [OpenAIService],
})
export class OpenaiModule {}
