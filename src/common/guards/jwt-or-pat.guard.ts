import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { extractPat, hashPat } from 'src/common/auth/pat';
import { AppErrorCode, AppException } from 'src/common/errors/app-exception';
import { JWT_STRATEGY_NAME } from 'src/google/google.constants';
import { PrismaService } from 'src/prisma/prisma.service';
import { IJwtSignData } from 'src/utils';

// Accepts either the browser's `jwt` cookie (unchanged behaviour) or a
// personal access token in `Authorization: Bearer psk_…` for non-browser
// clients such as the Claude Code MCP server. Either way `req.user` ends up
// as IJwtSignData, so ApprovedGuard and controllers work unchanged.
@Injectable()
export class JwtOrPatGuard extends AuthGuard(JWT_STRATEGY_NAME) {
  private readonly logger = new Logger(JwtOrPatGuard.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = extractPat(req.headers.authorization);
    if (!token) return (await super.canActivate(context)) as boolean;

    const pat = await this.prisma.personalAccessToken.findUnique({
      where: { token_hash: hashPat(token) },
      select: {
        id: true,
        revoked_at: true,
        user: { select: { id: true, email: true } },
      },
    });
    if (!pat || pat.revoked_at) {
      throw new AppException(
        AppErrorCode.UNAUTHENTICATED,
        'Invalid or revoked access token',
      );
    }

    req.user = { sub: pat.user.id, email: pat.user.email } as IJwtSignData;

    // Best-effort bookkeeping — never fail the request over it.
    this.prisma.personalAccessToken
      .update({ where: { id: pat.id }, data: { last_used_at: new Date() } })
      .catch((err: unknown) =>
        this.logger.warn(`Failed to update PAT last_used_at: ${String(err)}`),
      );

    return true;
  }
}
