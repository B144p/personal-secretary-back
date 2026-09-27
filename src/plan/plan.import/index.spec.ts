import { EPlanSourceType, EPlanStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  IMPORT_MAX_DEPTH,
  IMPORT_MAX_TASKS,
  importPlanSchema,
} from '../dto/import-plan.dto';
import { PlanImportService } from './index';

describe('PlanImportService', () => {
  let planCreate: jest.Mock;
  let taskCreate: jest.Mock;
  let taskEventCreate: jest.Mock;
  let taskEventCreateMany: jest.Mock;
  let service: PlanImportService;

  beforeEach(() => {
    let seq = 0;
    planCreate = jest.fn().mockResolvedValue({ id: 'plan1' });
    taskCreate = jest
      .fn()
      .mockImplementation(() => Promise.resolve({ id: `task${++seq}` }));
    taskEventCreate = jest.fn();
    taskEventCreateMany = jest.fn();
    const tx = {
      plan: {
        create: planCreate,
        findUnique: jest.fn().mockResolvedValue({ id: 'plan1', tasks: [] }),
      },
      task: { create: taskCreate },
      taskEvent: { create: taskEventCreate, createMany: taskEventCreateMany },
    };
    const prisma = {
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaService;
    // Prisma is the only dependency — nothing to reach OpenAI or the calendar.
    service = new PlanImportService(prisma);
  });

  it('creates a DRAFT plan tagged CLAUDE_CODE with the given source_id', async () => {
    await service.importPlan('u1', {
      title: 'CSV export',
      source_id: 'git@github.com:me/repo.git',
      tasks: [{ title: 'Only step' }],
    });

    expect(planCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: 'u1',
          source_type: EPlanSourceType.CLAUDE_CODE,
          source_id: 'git@github.com:me/repo.git',
          status: EPlanStatus.DRAFT,
        }),
      }),
    );
  });

  it('writes the nested tree with correct depth, parent and sequence order', async () => {
    await service.importPlan('u1', {
      title: 'Plan',
      tasks: [
        {
          title: 'A',
          children: [{ title: 'A1' }, { title: 'A2', description: 'why' }],
        },
        { title: 'B' },
      ],
    });

    const rows = taskCreate.mock.calls.map(
      ([{ data }]: [{ data: Record<string, unknown> }]) => data,
    );
    expect(rows).toEqual([
      expect.objectContaining({
        title: 'A',
        depth: 0,
        parent_task_id: null,
        sequence_order: 0,
      }),
      expect.objectContaining({
        title: 'A1',
        depth: 1,
        parent_task_id: 'task1',
        sequence_order: 0,
        estimated_minutes: null,
      }),
      expect.objectContaining({
        title: 'A2',
        depth: 1,
        parent_task_id: 'task1',
        sequence_order: 1,
        description: 'why',
      }),
      expect.objectContaining({
        title: 'B',
        depth: 0,
        parent_task_id: null,
        sequence_order: 1,
      }),
    ]);
  });

  it('never writes calendar events', async () => {
    await service.importPlan('u1', {
      title: 'Plan',
      tasks: [{ title: 'A', children: [{ title: 'A1' }] }],
    });
    expect(taskEventCreate).not.toHaveBeenCalled();
    expect(taskEventCreateMany).not.toHaveBeenCalled();
  });
});

describe('importPlanSchema', () => {
  const chain = (levels: number) => {
    let node: { title: string; children?: unknown[] } = { title: 'leaf' };
    for (let i = 1; i < levels; i++)
      node = { title: `l${i}`, children: [node] };
    return node;
  };

  it(`accepts a tree of exactly ${IMPORT_MAX_DEPTH + 1} levels`, () => {
    const res = importPlanSchema.safeParse({
      title: 'ok',
      tasks: [chain(IMPORT_MAX_DEPTH + 1)],
    });
    expect(res.success).toBe(true);
  });

  it('rejects a tree deeper than the max depth', () => {
    const res = importPlanSchema.safeParse({
      title: 'deep',
      tasks: [chain(IMPORT_MAX_DEPTH + 2)],
    });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toMatch(/too deep/);
  });

  it('rejects more than the max number of tasks', () => {
    const res = importPlanSchema.safeParse({
      title: 'big',
      tasks: Array.from({ length: IMPORT_MAX_TASKS + 1 }, (_, i) => ({
        title: `t${i}`,
      })),
    });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toMatch(/Too many tasks/);
  });

  it('rejects an empty task list and blank titles', () => {
    expect(importPlanSchema.safeParse({ title: 'x', tasks: [] }).success).toBe(
      false,
    );
    expect(
      importPlanSchema.safeParse({ title: 'x', tasks: [{ title: '  ' }] })
        .success,
    ).toBe(false);
  });
});
