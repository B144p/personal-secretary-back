import { z } from 'zod';

export const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  estimated_minutes: z.number().int().min(15).max(240).optional(),
  sequence_order: z.number().int().min(0).optional(),
  parent_task_id: z.string().optional(),
});

export type CreateTaskDto = z.infer<typeof createTaskSchema>;
