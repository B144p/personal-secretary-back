import { z } from 'zod';

export const generatePlanResponseSchema = z.object({
  goal: z.string(),
  duration_days: z.number(),
  daily_tasks: z.array(
    z.object({
      // day: z.number(),
      title: z.string(),
      // objective: z.string(),
      tasks: z.array(z.string()),
      estimated_hours: z.number(),
      priority: z.enum(['low', 'medium', 'high']),
      status: z.enum(['pending', 'in-progress', 'completed']),
    }),
  ),
});

export type IGeneratePlanResponse = z.infer<typeof generatePlanResponseSchema>;
