import { z } from 'zod';

export const generatePlanSchema = z.object({
  goal: z.string().min(1),
  more_info: z.string().optional(),
});

export type GeneratePlanDto = z.infer<typeof generatePlanSchema>;
