import { z } from 'zod';

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export const updateSettingsSchema = z.object({
  working_hours_start: z
    .string()
    .regex(timePattern, 'Must be HH:MM')
    .optional(),
  working_hours_end: z.string().regex(timePattern, 'Must be HH:MM').optional(),
  days_off: z.array(z.number().int().min(0).max(6)).optional(),
  time_zone: z
    .string()
    .refine((tz) => {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Invalid IANA time zone')
    .optional(),
  special_days: z
    .array(
      z.object({
        date: z.string(),
        available: z.boolean(),
      }),
    )
    .optional(),
});

export type UpdateSettingsDto = z.infer<typeof updateSettingsSchema>;
