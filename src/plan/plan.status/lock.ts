import type { Prisma } from '@prisma/client';

// Status rollup reads the whole task tree and writes back derived parent and
// plan statuses. Claude Code often sends several updates at once; without a
// lock two transactions each see the other's sibling as still open and the
// parent / plan never close. Holding the plan row serializes them per plan.
export const lockPlanRow = async (
  tx: Prisma.TransactionClient,
  planId: string,
) => {
  await tx.$queryRaw`SELECT id FROM "plan" WHERE id = ${planId} FOR UPDATE`;
};

// Waiting on the lock can exceed Prisma's 5s interactive-transaction default.
export const ROLLUP_TX_OPTIONS = { timeout: 15_000, maxWait: 10_000 };
