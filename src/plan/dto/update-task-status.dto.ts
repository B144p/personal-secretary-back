import { z } from 'zod';

// Status Claude Code reports while it works through a plan. HOLD stays with
// the calendar flow; CANCELLED needs a reason so a later session doesn't
// rebuild what was dropped on purpose.
export const TASK_STATUS_UPDATES = [
  'PENDING',
  'IN_PROGRESS',
  'DONE',
  'CANCELLED',
] as const;

export const updateTaskStatusSchema = z
  .object({
    status: z.enum(TASK_STATUS_UPDATES),
    note: z.string().trim().min(1).max(1000).optional(),
  })
  .refine((b) => b.status !== 'CANCELLED' || !!b.note, {
    path: ['note'],
    message: 'A note (the reason) is required when cancelling a task',
  });

export type UpdateTaskStatusDto = z.infer<typeof updateTaskStatusSchema>;
