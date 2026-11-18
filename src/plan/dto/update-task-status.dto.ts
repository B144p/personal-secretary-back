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

export const BULK_TASK_STATUS_MAX_UPDATES = 100;

// Several status changes for one plan, applied together. Errors name the task
// so the caller can fix the whole list in one retry.
export const bulkUpdateTaskStatusSchema = z
  .object({
    updates: z
      .array(
        z.object({
          task_id: z.string().trim().min(1),
          status: z.enum(TASK_STATUS_UPDATES),
          note: z.string().trim().min(1).max(1000).optional(),
        }),
      )
      .min(1)
      .max(BULK_TASK_STATUS_MAX_UPDATES),
  })
  .superRefine(({ updates }, ctx) => {
    const seen = new Set<string>();
    updates.forEach(({ task_id, status, note }, i) => {
      if (seen.has(task_id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['updates', i, 'task_id'],
          message: `Task ${task_id} is listed more than once`,
        });
      }
      seen.add(task_id);
      if (status === 'CANCELLED' && !note) {
        ctx.addIssue({
          code: 'custom',
          path: ['updates', i, 'note'],
          message: `A note (the reason) is required when cancelling task ${task_id}`,
        });
      }
    });
  });

export type BulkUpdateTaskStatusDto = z.infer<
  typeof bulkUpdateTaskStatusSchema
>;
