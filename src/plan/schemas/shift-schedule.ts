import { z } from 'zod';

export const generateShiftScheduleResponseSchema = z.object({});

export type IGenerateShiftScheduleResponse = z.infer<
  typeof generateShiftScheduleResponseSchema
>;
