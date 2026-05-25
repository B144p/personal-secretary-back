import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { getRequiredEnv, IJwtSignData } from 'src/utils';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const { email } = req.user as IJwtSignData;
    const adminEmail = getRequiredEnv('ADMIN_EMAIL');

    if (email !== adminEmail) {
      throw new ForbiddenException();
    }

    return true;
  }
}
