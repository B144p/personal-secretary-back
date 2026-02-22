import { EEventCategory } from '@prisma/client';
import { z } from 'zod';

const CategoryRuleSchema = z.object({
  keyword: z.string(),
  category: z.enum(EEventCategory),
  tags: z.array(z.string()),
});

export const CategoryRulesSchema = z.object({
  results: z.array(CategoryRuleSchema),
});

export type ICategoryRulesResponse = z.infer<typeof CategoryRulesSchema>;

export const CalendarGeneratorSchema = z.object({
  results: z.array(z.string()),
});

export type ICalendarGeneratorResultResponse = z.infer<
  typeof CalendarGeneratorSchema
>;
