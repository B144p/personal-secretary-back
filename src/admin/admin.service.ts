import { Injectable } from '@nestjs/common';
import { AppErrorCode, AppException } from 'src/common/errors/app-exception';
import { PrismaService } from 'src/prisma/prisma.service';
import { getRequiredEnv } from 'src/utils';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  listUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        avatar_url: true,
        status: true,
        created_at: true,
      },
      orderBy: { created_at: 'asc' },
    });
  }

  async approveUser(id: string) {
    await this.prisma.user.update({
      where: { id },
      data: { status: 'APPROVED' },
    });
    return { message: 'User approved.' };
  }

  async rejectUser(id: string) {
    const adminEmail = getRequiredEnv('ADMIN_EMAIL');
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { email: true },
    });

    if (target?.email === adminEmail) {
      throw new AppException(
        AppErrorCode.CANNOT_REJECT_ADMIN,
        'The admin account cannot be rejected.',
      );
    }

    await this.prisma.user.update({
      where: { id },
      data: { status: 'REJECTED' },
    });
    return { message: 'User rejected.' };
  }
}
