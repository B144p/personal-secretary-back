import { Injectable } from '@nestjs/common';
import { AppErrorCode, AppException } from 'src/common/errors/app-exception';
import { PrismaService } from 'src/prisma/prisma.service';

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

  private async assertTargetNotAdmin(id: string) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { status: true },
    });
    if (target?.status === 'ADMIN') {
      throw new AppException(
        AppErrorCode.CANNOT_MODIFY_ADMIN,
        'Admin accounts cannot be modified from the UI.',
      );
    }
  }

  async approveUser(id: string) {
    await this.assertTargetNotAdmin(id);
    await this.prisma.user.update({
      where: { id },
      data: { status: 'APPROVED' },
    });
    return { message: 'User approved.' };
  }

  async rejectUser(id: string) {
    await this.assertTargetNotAdmin(id);
    await this.prisma.user.update({
      where: { id },
      data: { status: 'REJECTED' },
    });
    return { message: 'User rejected.' };
  }
}
