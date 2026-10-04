import { EPlanSourceType, EPlanStatus, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  IMPORT_MAX_DEPTH,
  IMPORT_MAX_TASKS,
  importPlanSchema,
} from '../dto/import-plan.dto';
import { PlanImportService } from './index';

describe('PlanImportService', () => {
  let planCreate: jest.Mock;
  let planFindFirst: jest.Mock;
  let taskCreate: jest.Mock;
  let taskEventCreate: jest.Mock;
  let taskEventCreateMany: jest.Mock;
  let service: PlanImportService;

  beforeEach(() => {
    let seq = 0;
    planCreate = jest.fn().mockResolvedValue({ id: 'plan1' });
    planFindFirst = jest.fn().mockResolvedValue({ id: 'parent1' });
    taskCreate = jest
      .fn()
      .mockImplementation(() => Promise.resolve({ id: `task${++seq}` }));
    taskEventCreate = jest.fn();
    taskEventCreateMany = jest.fn();
    const tx = {
      plan: {
        create: planCreate,
        findUnique: jest.fn().mockResolvedValue({ id: 'plan1', tasks: [] }),
        findFirst: planFindFirst,
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

  it('stores a normalized repo_key, the branch and the parent plan', async () => {
    const parentId = '65f357f3-d79e-4e8b-bef8-58086469c7e3';
    planFindFirst.mockResolvedValue({ id: parentId });
    await service.importPlan('u1', {
      title: 'Follow-up',
      repo_key: 'git@github.com:me/repo.git',
      branch: 'feat/x',
      parent_plan_id: parentId,
      tasks: [{ title: 'Only step' }],
    });

    expect(planFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: parentId, user_id: 'u1' } }),
    );
    expect(planCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          repo_key: 'github.com/me/repo',
          branch: 'feat/x',
          parent_plan_id: parentId,
        }),
      }),
    );
  });

  it('falls back to source_id for repo_key', async () => {
    await service.importPlan('u1', {
      title: 'Old client',
      source_id: 'https://github.com/me/repo.git',
      tasks: [{ title: 'Only step' }],
    });

    expect(planCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          repo_key: 'github.com/me/repo',
          branch: null,
          parent_plan_id: null,
        }),
      }),
    );
  });

  it("saves the plan without the link when the parent plan is not the user's", async () => {
    planFindFirst.mockResolvedValue(null);
    await service.importPlan('u1', {
      title: 'Follow-up',
      parent_plan_id: '65f357f3-d79e-4e8b-bef8-58086469c7e3',
      tasks: [{ title: 'Only step' }],
    });
    expect(planCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ parent_plan_id: null }),
      }),
    );
  });

  it('stores an agent plan with its source and step estimates', async () => {
    await service.importPlan('u1', {
      title: 'Learn Go',
      source_type: 'AGENT',
      source_id: 'tutor',
      tasks: [
        {
          title: 'Week 1',
          children: [{ title: 'Tour of Go', estimated_minutes: 45 }],
        },
      ],
    });

    expect(planCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source_type: EPlanSourceType.AGENT,
          source_id: 'tutor',
          status: EPlanStatus.DRAFT,
        }),
      }),
    );
    expect(taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Tour of Go',
          estimated_minutes: 45,
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

describe('PlanImportService import_key dedupe', () => {
  const dto = {
    title: 'CSV export',
    import_key: 'session1:abc',
    tasks: [{ title: 'Only step' }],
  };

  const makeService = (existing: { id: string } | null) => {
    const planCreate = jest.fn().mockResolvedValue({ id: 'new' });
    const findUnique = jest.fn(
      (args: { where: { id?: string }; select?: unknown }) =>
        Promise.resolve(
          args.select ? existing : { id: args.where.id, tasks: [] },
        ),
    );
    const tx = {
      plan: { create: planCreate, findUnique },
      task: { create: jest.fn().mockResolvedValue({ id: 't1' }) },
    };
    const prisma = {
      plan: { findUnique },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) =>
        fn(tx),
      ) as jest.Mock,
    };
    return {
      planCreate,
      prisma,
      service: new PlanImportService(prisma as unknown as PrismaService),
    };
  };

  it('returns the existing plan when the key was already imported', async () => {
    const { service, planCreate } = makeService({ id: 'existing' });
    const plan = await service.importPlan('u1', dto);
    expect(plan).toMatchObject({ id: 'existing' });
    expect(planCreate).not.toHaveBeenCalled();
  });

  it('stores the key on a first import', async () => {
    const { service, planCreate } = makeService(null);
    await service.importPlan('u1', dto);
    expect(planCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ import_key: 'session1:abc' }),
      }),
    );
  });

  it('returns the winner when a concurrent import hits the unique key', async () => {
    const { service, prisma } = makeService(null);
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    prisma.plan.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'winner' });
    const plan = await service.importPlan('u1', dto);
    expect(plan).toMatchObject({ id: 'winner' });
  });
});

describe('importPlanSchema for agent plans', () => {
  const agentPlan = {
    title: 'Learn Go',
    source_type: 'AGENT',
    source_id: 'tutor',
    tasks: [
      { title: 'Week 1', children: [{ title: 'Tour', estimated_minutes: 45 }] },
    ],
  };

  it('needs an agent name and an estimate on every leaf', () => {
    expect(importPlanSchema.safeParse(agentPlan).success).toBe(true);
    expect(
      importPlanSchema.safeParse({ ...agentPlan, source_id: undefined })
        .success,
    ).toBe(false);
    expect(
      importPlanSchema.safeParse({
        ...agentPlan,
        tasks: [{ title: 'Week 1', children: [{ title: 'Tour' }] }],
      }).success,
    ).toBe(false);
  });

  it('keeps Claude Code imports as before: default source, no estimates needed', () => {
    const parsed = importPlanSchema.parse({
      title: 'x',
      tasks: [{ title: 'y' }],
    });
    expect(parsed.source_type).toBe('CLAUDE_CODE');
    expect(
      importPlanSchema.safeParse({
        title: 'x',
        tasks: [{ title: 'y', estimated_minutes: 2 }],
      }).success,
    ).toBe(false);
  });
});
