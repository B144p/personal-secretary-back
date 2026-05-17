import { z } from 'zod';

export const reGeneratePlanSchema = z.object({
  reason: z.string().min(10, 'reason must be at least 10 characters'),
  task_id: z.string().optional(),
  feedback: z.string().optional(),
});

export type ReGeneratePlanDto = z.infer<typeof reGeneratePlanSchema>;
