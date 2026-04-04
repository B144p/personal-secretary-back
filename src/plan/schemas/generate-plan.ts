import { z } from 'zod';

export const generatePlanResponseSchema = z.object({
  goal: z.string(),
  tasks: z.array(z.string()),
});

export type IGeneratePlanResponse = z.infer<typeof generatePlanResponseSchema>;
