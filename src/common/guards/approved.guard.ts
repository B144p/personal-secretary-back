import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AppErrorCode, AppException } from 'src/common/errors/app-exception';
import { PrismaService } from 'src/prisma/prisma.service';
import { IJwtSignData } from 'src/utils';

@Injectable()
export class ApprovedGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const { sub } = req.user as IJwtSignData;

    const user = await this.prisma.user.findUnique({
      where: { id: sub },
      select: { status: true },
    });

    if (!user || user.status === 'PENDING') {
      throw new AppException(
        AppErrorCode.ACCOUNT_PENDING,
        'Your account is pending approval.',
      );
    }

    if (user.status === 'REJECTED') {
      throw new AppException(
        AppErrorCode.ACCOUNT_REJECTED,
        'Your access has been rejected.',
      );
    }

    // APPROVED and ADMIN both pass
    return true;
  }
}
