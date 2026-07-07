import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

interface ActiveTaskEventWrite {
  taskId: string;
  googleEventId: string;
  start: string | Date;
  end: string | Date;
  /** Update this existing row → active. Resume passes its most-recent inactive row;
   *  in-place PENDING patch passes the live active row (googleEventId unchanged). */
  reuseRowId?: string;
  /** Deactivate the task's current active row(s) and insert a fresh one, keeping the
   *  old row as history (IN_PROGRESS reschedule). Ignored when reuseRowId is set. */
  preserveHistory?: boolean;
}

/** Build the DB ops that make `googleEventId` the task's single active scheduled event. */
export const buildActiveTaskEventWrite = (
  prisma: PrismaService,
  {
    taskId,
    googleEventId,
    start,
    end,
    reuseRowId,
    preserveHistory,
  }: ActiveTaskEventWrite,
): Prisma.PrismaPromise<unknown>[] => {
  const data = {
    google_event_id: googleEventId,
    start: new Date(start),
    end: new Date(end),
    is_active: true,
  };
  if (reuseRowId)
    return [prisma.taskEvent.update({ where: { id: reuseRowId }, data })];
  if (preserveHistory)
    return [
      prisma.taskEvent.updateMany({
        where: { task_id: taskId, is_active: true },
        data: { is_active: false },
      }),
      prisma.taskEvent.create({ data: { task_id: taskId, ...data } }),
    ];
  return [prisma.taskEvent.create({ data: { task_id: taskId, ...data } })];
};
