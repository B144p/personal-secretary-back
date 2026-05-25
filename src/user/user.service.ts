import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AppErrorCode, AppException } from 'src/common/errors/app-exception';
import {
  UpdateSettingsDto,
  updateSettingsSchema,
} from './dto/update-settings.dto';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        user_state: true,
      },
    });
    if (!user) {
      throw new Error('User not found');
    }
    return user;
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
}
