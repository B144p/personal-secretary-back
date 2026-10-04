import { Injectable } from '@nestjs/common';
import { EPlanStatus } from '@prisma/client';
import { normalizeRepoKey } from 'src/plan/repo-key';
import { PrismaService } from 'src/prisma/prisma.service';
import { buildRepoContext } from './context.builder';
import type { RepoContextQuery } from './context.dto';

// What a new Claude Code session in a repo should know: the open plan to
// resume and what is left. Read-only; never touches OpenAI or the calendar.
@Injectable()
export class ContextService {
  constructor(private readonly prisma: PrismaService) {}

  async getRepoContext(userId: string, query: RepoContextQuery) {
    const repoKey = normalizeRepoKey(query.repo_key);
    const held = await this.prisma.plan.count({
      where: { user_id: userId, repo_key: repoKey, status: EPlanStatus.HOLD },
    });
    const plans = await this.prisma.plan.findMany({
      where: {
        user_id: userId,
        repo_key: repoKey,
        status: { notIn: [EPlanStatus.DONE, EPlanStatus.HOLD] },
      },
      select: {
        id: true,
        title: true,
        status: true,
        branch: true,
        last_activity_at: true,
        tasks: {
          select: {
            id: true,
            parent_task_id: true,
            title: true,
            status: true,
            status_note: true,
            sequence_order: true,
          },
        },
      },
    });
    return buildRepoContext({
      repoKey,
      branch: query.branch ?? null,
      plans,
      held,
      now: new Date(),
    });
  }
}
