import { z } from 'zod';

export const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  estimated_minutes: z.number().int().min(15).max(240).optional(),
});

export type UpdateTaskDto = z.infer<typeof updateTaskSchema>;
