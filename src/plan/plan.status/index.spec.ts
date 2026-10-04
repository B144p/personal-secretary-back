import { EPlanSourceType, EPlanStatus, ETaskStatus } from '@prisma/client';
import { AppErrorCode } from 'src/common/errors/app-exception';
import { PrismaService } from 'src/prisma/prisma.service';
import { PlanTaskStatusService } from './index';

describe('PlanTaskStatusService', () => {
  const makeService = (sourceType: EPlanSourceType) => {
    const calls: string[] = [];
    const tx = {
      $queryRaw: jest.fn(() => {
        calls.push('lock');
        return Promise.resolve([]);
      }),
      plan: {
        findUnique: jest
          .fn()
          .mockImplementationOnce(() => {
            calls.push('read');
            return Promise.resolve({
              id: 'plan1',
              source_type: sourceType,
              status: EPlanStatus.DRAFT,
              tasks: [
                { id: 'A', parent_task_id: null, status: ETaskStatus.PENDING },
                { id: 'A1', parent_task_id: 'A', status: ETaskStatus.PENDING },
              ],
            });
          })
          .mockResolvedValue({ id: 'plan1', tasks: [] }),
        update: jest.fn(),
      },
      task: { update: jest.fn() },
      taskEvent: {
        create: jest.fn(),
        createMany: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaService;
    return { tx, calls, service: new PlanTaskStatusService(prisma) };
  };

  it('stores the status and note, rolls up the parent and plan, and never writes TaskEvents', async () => {
    const { tx, service } = makeService(EPlanSourceType.CLAUDE_CODE);
    await service.updateStatus({
      userId: 'u1',
      planId: 'plan1',
      taskId: 'A1',
      dto: { status: 'CANCELLED', note: 'endpoint already existed' },
    });

    expect(tx.task.update).toHaveBeenCalledWith({
      where: { id: 'A1' },
      data: {
        status: ETaskStatus.CANCELLED,
        status_note: 'endpoint already existed',
      },
    });
    expect(tx.task.update).toHaveBeenCalledWith({
      where: { id: 'A' },
      data: { status: ETaskStatus.CANCELLED },
    });
    expect(tx.plan.update).toHaveBeenCalledWith({
      where: { id: 'plan1' },
      data: {
        status: EPlanStatus.DONE,
        last_activity_at: expect.any(Date),
      },
    });
    expect(tx.taskEvent.create).not.toHaveBeenCalled();
    expect(tx.taskEvent.createMany).not.toHaveBeenCalled();
    expect(tx.taskEvent.updateMany).not.toHaveBeenCalled();
  });

  it('picks a stale HOLD plan up again: a step update moves it to READY', async () => {
    const { tx, service } = makeService(EPlanSourceType.CLAUDE_CODE);
    tx.plan.findUnique.mockReset();
    tx.plan.findUnique
      .mockResolvedValueOnce({
        id: 'plan1',
        source_type: EPlanSourceType.CLAUDE_CODE,
        status: EPlanStatus.HOLD,
        is_paused: false,
        tasks: [
          { id: 'A', parent_task_id: null, status: ETaskStatus.PENDING },
          { id: 'B', parent_task_id: null, status: ETaskStatus.PENDING },
        ],
      })
      .mockResolvedValue({ id: 'plan1', tasks: [] });

    await service.updateStatus({
      userId: 'u1',
      planId: 'plan1',
      taskId: 'A',
      dto: { status: 'IN_PROGRESS' },
    });

    expect(tx.plan.update).toHaveBeenCalledWith({
      where: { id: 'plan1' },
      data: { status: EPlanStatus.READY, last_activity_at: expect.any(Date) },
    });
  });

  it('locks the plan row before reading the task tree', async () => {
    const { tx, calls, service } = makeService(EPlanSourceType.CLAUDE_CODE);
    await service.updateStatus({
      userId: 'u1',
      planId: 'plan1',
      taskId: 'A1',
      dto: { status: 'DONE' },
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(calls.slice(0, 2)).toEqual(['lock', 'read']);
  });

  it('rejects plans that did not come from Claude Code', async () => {
    const { tx, service } = makeService(EPlanSourceType.GENERATE);
    await expect(
      service.updateStatus({
        userId: 'u1',
        planId: 'plan1',
        taskId: 'A1',
        dto: { status: 'DONE' },
      }),
    ).rejects.toMatchObject({ code: AppErrorCode.PLAN_SOURCE_NOT_SUPPORTED });
    expect(tx.task.update).not.toHaveBeenCalled();
  });
});
