import { Injectable } from '@nestjs/common';
import { EPlanSourceType, EPlanStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import type { ImportPlanDto, ImportTaskNode } from '../dto/import-plan.dto';
import type { ITaskNode } from '../schemas';
import { insertTaskTree, loadPlanWithTaskTree } from '../task-tree';

// Creates a plan from tasks Claude Code already wrote in plan mode.
//
// Deliberately depends on Prisma only: no OpenAI (the plan is given, not
// generated) and no calendar (an imported plan is a DRAFT with no events).
// See source-guard.ts for the matching block on re_generate/schedule.
@Injectable()
export class PlanImportService {
  constructor(private readonly prisma: PrismaService) {}

  async importPlan(userId: string, dto: ImportPlanDto) {
    const title =
      process.env.NODE_ENV === 'development' ? `[DEV] ${dto.title}` : dto.title;

    return this.prisma.$transaction(
      async (tx) => {
        const created = await tx.plan.create({
          data: {
            user_id: userId,
            title,
            source_type: EPlanSourceType.CLAUDE_CODE,
            source_id: dto.source_id ?? null,
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
