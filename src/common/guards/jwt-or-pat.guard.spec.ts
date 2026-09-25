import { ExecutionContext } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { hashPat } from '../auth/pat';
import { AppErrorCode } from '../errors/app-exception';
import { JwtOrPatGuard } from './jwt-or-pat.guard';

const contextFor = (req: Record<string, unknown>) =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

describe('JwtOrPatGuard', () => {
  let findUnique: jest.Mock;
  let update: jest.Mock;
  let guard: JwtOrPatGuard;
  let jwtCanActivate: jest.SpyInstance;

  beforeEach(() => {
    findUnique = jest.fn();
    update = jest.fn().mockResolvedValue({});
    guard = new JwtOrPatGuard({
      personalAccessToken: { findUnique, update },
    } as unknown as PrismaService);
    // The passport JWT path (AuthGuard base class) — stubbed so we only
    // assert whether the guard delegates to it.
    jwtCanActivate = jest
      .spyOn(Object.getPrototypeOf(JwtOrPatGuard.prototype), 'canActivate')
      .mockResolvedValue(true);
  });

  afterEach(() => jwtCanActivate.mockRestore());

  it('authenticates a valid PAT and sets req.user in the JWT payload shape', async () => {
    findUnique.mockResolvedValue({
      id: 'pat1',
      revoked_at: null,
      user: { id: 'u1', email: 'a@b.c' },
    });
    const req: Record<string, unknown> = {
      headers: { authorization: 'Bearer psk_good' },
    };

    await expect(guard.canActivate(contextFor(req))).resolves.toBe(true);

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { token_hash: hashPat('psk_good') } }),
    );
    expect(req.user).toEqual({ sub: 'u1', email: 'a@b.c' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pat1' } }),
    );
    expect(jwtCanActivate).not.toHaveBeenCalled();
  });

  it('rejects an unknown PAT', async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      guard.canActivate(
        contextFor({ headers: { authorization: 'Bearer psk_unknown' } }),
      ),
    ).rejects.toMatchObject({ code: AppErrorCode.UNAUTHENTICATED });
    expect(jwtCanActivate).not.toHaveBeenCalled();
  });

  it('rejects a revoked PAT', async () => {
    findUnique.mockResolvedValue({
      id: 'pat1',
      revoked_at: new Date(),
      user: { id: 'u1', email: 'a@b.c' },
    });
    await expect(
      guard.canActivate(
        contextFor({ headers: { authorization: 'Bearer psk_revoked' } }),
      ),
    ).rejects.toMatchObject({ code: AppErrorCode.UNAUTHENTICATED });
  });

  it('falls through to cookie JWT auth when no PAT is sent', async () => {
    await expect(guard.canActivate(contextFor({ headers: {} }))).resolves.toBe(
      true,
    );
    expect(jwtCanActivate).toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('falls through to JWT auth for a non-PAT bearer token', async () => {
    await guard.canActivate(
      contextFor({ headers: { authorization: 'Bearer eyJhbGciOi.jwt' } }),
    );
    expect(jwtCanActivate).toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('does not fail the request when last_used_at bookkeeping fails', async () => {
    findUnique.mockResolvedValue({
      id: 'pat1',
      revoked_at: null,
      user: { id: 'u1', email: 'a@b.c' },
    });
    update.mockRejectedValue(new Error('db hiccup'));
    await expect(
      guard.canActivate(
        contextFor({ headers: { authorization: 'Bearer psk_good' } }),
      ),
    ).resolves.toBe(true);
  });
});
