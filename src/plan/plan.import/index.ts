import { Injectable, Logger } from '@nestjs/common';
import { EPlanSourceType, EPlanStatus, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import type { ImportPlanDto, ImportTaskNode } from '../dto/import-plan.dto';
import { normalizeRepoKey } from '../repo-key';
import type { ITaskNode } from '../schemas';
import { insertTaskTree, loadPlanWithTaskTree } from '../task-tree';

// Creates a plan from tasks Claude Code already wrote in plan mode.
//
// Deliberately depends on Prisma only: no OpenAI (the plan is given, not
// generated) and no calendar (an imported plan is a DRAFT with no events).
// See source-guard.ts for the matching block on re_generate/schedule.
@Injectable()
export class PlanImportService {
  private readonly logger = new Logger(PlanImportService.name);

  constructor(private readonly prisma: PrismaService) {}

  async importPlan(userId: string, dto: ImportPlanDto) {
    if (dto.import_key) {
      const existing = await this.findByImportKey(userId, dto.import_key);
      if (existing) return existing;
    }
    try {
      return await this.create(userId, dto);
    } catch (err) {
      // Two sends of the same key raced: the other one won, return its plan.
      if (dto.import_key && isUniqueViolation(err)) {
        const existing = await this.findByImportKey(userId, dto.import_key);
        if (existing) return existing;
      }
      throw err;
    }
  }

  private async findByImportKey(userId: string, importKey: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { user_id_import_key: { user_id: userId, import_key: importKey } },
      select: { id: true },
    });
    return plan ? loadPlanWithTaskTree(this.prisma, plan.id) : null;
  }

  private async create(userId: string, dto: ImportPlanDto) {
    const title =
      process.env.NODE_ENV === 'development' ? `[DEV] ${dto.title}` : dto.title;

    return this.prisma.$transaction(
      async (tx) => {
        // The link is only metadata: a parent that was deleted, lives in the
        // other backend (dev vs prod) or isn't the user's is dropped, never
        // a reason to lose the plan itself.
        let parentPlanId: string | null = null;
        if (dto.parent_plan_id) {
          const parent = await tx.plan.findFirst({
            where: { id: dto.parent_plan_id, user_id: userId },
            select: { id: true },
          });
          if (parent) parentPlanId = parent.id;
          else
            this.logger.warn(
              `Parent plan ${dto.parent_plan_id} not found for user ${userId}; importing without the link`,
            );
        }
        const repoKey = dto.repo_key ?? dto.source_id;
        const created = await tx.plan.create({
          data: {
            user_id: userId,
            title,
            source_type: EPlanSourceType.CLAUDE_CODE,
            source_id: dto.source_id ?? null,
            import_key: dto.import_key ?? null,
            repo_key: repoKey ? normalizeRepoKey(repoKey) : null,
            branch: dto.branch ?? null,
            parent_plan_id: parentPlanId,
            status: EPlanStatus.DRAFT,
          },
        });

        await insertTaskTree({
          client: tx,
          planId: created.id,
          tasks: toTaskNodes(dto.tasks),
          parentId: null,
          depth: 0,
        });

        return loadPlanWithTaskTree(tx, created.id);
      },
      // Up to IMPORT_MAX_TASKS sequential inserts against a remote DB can
      // exceed Prisma's 5s default for interactive transactions.
      { timeout: 30_000 },
    );
  }
}

// Claude's steps carry no time estimates — sequence comes from list order.
export const toTaskNodes = (nodes: ImportTaskNode[]): ITaskNode[] =>
  nodes.map((n, i) => ({
    title: n.title,
    description: n.description ?? '',
    sequence_order: i,
    estimated_minutes: null,
    children: toTaskNodes(n.children ?? []),
  }));

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
