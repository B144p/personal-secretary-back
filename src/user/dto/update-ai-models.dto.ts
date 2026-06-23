import { z } from 'zod';
import { allowedAiModelSchema } from 'src/openai/models';

export const updateAiModelsSchema = z.object({
  model_plan_generation: allowedAiModelSchema.optional(),
  model_regeneration: allowedAiModelSchema.optional(),
  model_scheduling: allowedAiModelSchema.optional(),
});

export type UpdateAiModelsDto = z.infer<typeof updateAiModelsSchema>;
