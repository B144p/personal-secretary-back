import { z } from 'zod';

export const ALLOWED_AI_MODELS = ['gpt-5', 'gpt-5-mini', 'gpt-5-nano'] as const;

export type AllowedAiModel = (typeof ALLOWED_AI_MODELS)[number];

export const allowedAiModelSchema = z.enum(ALLOWED_AI_MODELS);
