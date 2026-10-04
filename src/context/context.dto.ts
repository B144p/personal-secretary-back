import { z } from 'zod';

export const repoContextQuerySchema = z.object({
  // Git origin URL in any form, or the repo root path; normalized server side.
  repo_key: z.string().trim().min(1).max(500),
  branch: z.string().trim().min(1).max(200).optional(),
});

export type RepoContextQuery = z.infer<typeof repoContextQuerySchema>;
