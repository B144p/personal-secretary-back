import { z } from 'zod';
import { AGENDA_MAX_DAYS } from './agenda.builder';

export const agendaQuerySchema = z.object({
  // A day in the user's timezone; defaults to today there.
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
  days: z.coerce.number().int().min(1).max(AGENDA_MAX_DAYS).optional(),
});

export type AgendaQuery = z.infer<typeof agendaQuerySchema>;
