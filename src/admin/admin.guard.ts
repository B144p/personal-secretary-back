import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from 'src/prisma/prisma.service';
import { IJwtSignData } from 'src/utils';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const { sub } = req.user as IJwtSignData;

    const user = await this.prisma.user.findUnique({
      where: { id: sub },
      select: { status: true },
    });

    if (user?.status !== 'ADMIN') {
      throw new ForbiddenException();
    }

    return true;
  }
}
