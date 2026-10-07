import { z } from 'zod';

// Body of PATCH /plan-progress (web feedback form, and agents with a PAT).
// Zod only, so the MCP server can share it.
export const PROGRESS_STATUSES = [
  'PENDING',
  'IN_PROGRESS',
  'DONE',
  'HOLD',
] as const;

export const updateProgressSchema = z.object({
  statusChanges: z
    .array(
      z.object({
        taskId: z.string().min(1),
        newStatus: z.enum(PROGRESS_STATUSES),
      }),
    )
    .max(100)
    .default([]),
  contextText: z.string().trim().max(2000).optional(),
});

export type UpdateProgressDto = z.infer<typeof updateProgressSchema>;

// Body of POST /plan-progress/reschedule. The note, when given, is saved as
// that day's feedback text.
export const rescheduleSchema = z.object({
  note: z.string().trim().min(1).max(2000).optional(),
});
