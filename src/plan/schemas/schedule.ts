import { z } from 'zod';

export const generateScheduleResponseSchema = z.object({
  schedule: z.array(
    z.object({
      task_ref: z.string(),
      start: z.string(),
      end: z.string(),
    }),
  ),
});

export type IGenerateScheduleResponse = z.infer<
  typeof generateScheduleResponseSchema
>;
