import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { AppErrorCode, AppException } from 'src/common/errors/app-exception';
import { CryptoService } from 'src/crypto/crypto.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class OpenAIClientFactory {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async forUser(userId: string): Promise<OpenAI> {
    const aiSetting = await this.prisma.aiSetting.findUnique({
      where: { user_id: userId },
    });
    if (!aiSetting?.api_key_encrypted) {
      throw new AppException(
        AppErrorCode.AI_KEY_NOT_CONFIGURED,
        'Configure your OpenAI API key in settings before using AI features',
      );
    }
    const apiKey = this.crypto.decrypt(aiSetting.api_key_encrypted);
    return new OpenAI({ apiKey });
  }
}
