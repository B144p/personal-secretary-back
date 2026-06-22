import { z } from 'zod';

export const updateApiKeySchema = z.object({
  api_key: z.string().min(1, 'API key is required'),
});

export type UpdateApiKeyDto = z.infer<typeof updateApiKeySchema>;
