import { Global, Module } from '@nestjs/common';
import { CryptoModule } from 'src/crypto/crypto.module';
import { UserModule } from 'src/user/user.module';
import { CalendarClassifierService } from './calendar.classifier';
import { CalendarGeneratorService } from './calendar.generate';
import { OpenAIClientFactory } from './openai-client.factory';
import { OpenAIService } from './openai.service';

@Global()
@Module({
  imports: [CryptoModule, UserModule],
  providers: [
    OpenAIClientFactory,
    OpenAIService,
    CalendarClassifierService,
    CalendarGeneratorService,
  ],
  exports: [OpenAIClientFactory, OpenAIService],
})
export class OpenaiModule {}
