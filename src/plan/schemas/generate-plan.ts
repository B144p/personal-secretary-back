import { z } from 'zod';

const baseTaskFields = {
  title: z.string().min(1),
  description: z.string(),
  sequence_order: z.number().int().min(0),
  // null for branch nodes, integer for leaf nodes
  estimated_minutes: z.number().int().min(15).max(240).nullable(),
};

// Unrolled to depth 4 (OpenAI structured output cannot express recursion)
const depth4 = z.object({ ...baseTaskFields, children: z.tuple([]) });
const depth3 = z.object({ ...baseTaskFields, children: z.array(depth4) });
const depth2 = z.object({ ...baseTaskFields, children: z.array(depth3) });
const depth1 = z.object({ ...baseTaskFields, children: z.array(depth2) });
const depth0 = z.object({ ...baseTaskFields, children: z.array(depth1) });

export const generatePlanResponseSchema = z.object({
  goal: z.string(),
  tasks: z.array(depth0),
});

export type ITaskNode = {
  title: string;
  description: string;
  sequence_order: number;
  estimated_minutes: number | null;
  children: ITaskNode[];
};

export type IGeneratePlanResponse = {
  goal: string;
  tasks: ITaskNode[];
};
