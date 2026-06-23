import { BadRequestException, Injectable } from '@nestjs/common';
import { AiSetting } from '@prisma/client';
import OpenAI from 'openai';
import { PrismaService } from 'src/prisma/prisma.service';
import { AppErrorCode, AppException } from 'src/common/errors/app-exception';
import { CryptoService } from 'src/crypto/crypto.service';
import { IAiTaskModels } from 'src/openai/ai-task';
import { ALLOWED_AI_MODELS } from 'src/openai/models';
import { UpdateApiKeyDto, updateApiKeySchema } from './dto/update-api-key.dto';
import {
  UpdateAiModelsDto,
  updateAiModelsSchema,
} from './dto/update-ai-models.dto';
import {
  UpdateSettingsDto,
  updateSettingsSchema,
} from './dto/update-settings.dto';

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async getProfile(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        google_id: true,
        email: true,
        name: true,
        avatar_url: true,
        status: true,
        created_at: true,
        user_state: true,
      },
    });
    if (!user) {
      throw new Error('User not found');
    }
    return user;
  }

  async getRefreshToken(id: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { refresh_token: true },
    });
    if (!user) throw new Error('User not found');
    return user.refresh_token;
  }

  async getSettings(userId: string) {
    return this.prisma.userState.upsert({
      where: { user_id: userId },
      update: {},
      create: { user_id: userId },
    });
  }

  async updateSettings(userId: string, body: unknown) {
    const parsed = updateSettingsSchema.safeParse(body);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      if (field === 'working_hours_start' || field === 'working_hours_end') {
        throw new AppException(
          AppErrorCode.INVALID_HOURS,
          parsed.error.issues[0].message,
        );
      }
      if (field === 'time_zone') {
        throw new AppException(
          AppErrorCode.INVALID_TIMEZONE,
          parsed.error.issues[0].message,
        );
      }
      throw new BadRequestException(parsed.error.message);
    }

    const dto: UpdateSettingsDto = parsed.data;

    if (dto.working_hours_start && dto.working_hours_end) {
      if (dto.working_hours_end <= dto.working_hours_start) {
        throw new AppException(
          AppErrorCode.INVALID_HOURS,
          'working_hours_end must be after working_hours_start',
        );
      }
    } else {
      const current = await this.getSettings(userId);
      const start = dto.working_hours_start ?? current.working_hours_start;
      const end = dto.working_hours_end ?? current.working_hours_end;
      if (end <= start) {
        throw new AppException(
          AppErrorCode.INVALID_HOURS,
          'working_hours_end must be after working_hours_start',
        );
      }
    }

    return this.prisma.userState.update({
      where: { user_id: userId },
      data: {
        ...dto,
        special_days: dto.special_days ?? undefined,
      },
    });
  }

  // Used internally by AI call sites — no decryption, just the model picks.
  async getAiModels(userId: string): Promise<IAiTaskModels> {
    return this.prisma.aiSetting.upsert({
      where: { user_id: userId },
      update: {},
      create: { user_id: userId },
      select: {
        model_plan_generation: true,
        model_regeneration: true,
        model_scheduling: true,
      },
    });
  }

  async getAiSettings(userId: string) {
    const aiSetting = await this.prisma.aiSetting.upsert({
      where: { user_id: userId },
      update: {},
      create: { user_id: userId },
    });
    return this.toAiSettingsResponse(aiSetting);
  }

  async updateAiModels(userId: string, body: unknown) {
    const parsed = updateAiModelsSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.message);
    }

    const dto: UpdateAiModelsDto = parsed.data;
    const aiSetting = await this.prisma.aiSetting.upsert({
      where: { user_id: userId },
      update: dto,
      create: { user_id: userId, ...dto },
    });
    return this.toAiSettingsResponse(aiSetting);
  }

  async updateApiKey(userId: string, body: unknown) {
    const parsed = updateApiKeySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.message);
    }

    const dto: UpdateApiKeyDto = parsed.data;
    try {
      await new OpenAI({ apiKey: dto.api_key }).models.list();
    } catch {
      throw new AppException(
        AppErrorCode.INVALID_API_KEY,
        'The provided OpenAI API key is invalid.',
      );
    }

    const api_key_encrypted = this.crypto.encrypt(dto.api_key);
    const aiSetting = await this.prisma.aiSetting.upsert({
      where: { user_id: userId },
      update: { api_key_encrypted },
      create: { user_id: userId, api_key_encrypted },
    });
    return this.toAiSettingsResponse(aiSetting);
  }

  private toAiSettingsResponse(aiSetting: AiSetting) {
    const { api_key_encrypted, ...rest } = aiSetting;
    return {
      ...rest,
      available_models: ALLOWED_AI_MODELS,
      api_key: this.describeApiKey(api_key_encrypted),
    };
  }

  private describeApiKey(encrypted: string | null) {
    if (!encrypted) return { configured: false, last4: null };
    return {
      configured: true,
      last4: this.crypto.decrypt(encrypted).slice(-4),
    };
  }
}
