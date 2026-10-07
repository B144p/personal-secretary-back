import { z } from 'zod';

// Query for GET /plan. Zod only, so the MCP server can share it.
// With no params the list is every plan of the user, as before.
export const listPlansQuerySchema = z.object({
  // Matched after normalizeRepoKey, so any remote form of the repo works.
  repo_key: z.string().trim().min(1).max(500).optional(),
  // Only plans that are not DONE.
  open: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  source_type: z
    .enum(['GENERATE', 'CALENDAR', 'CLAUDE_CODE', 'AGENT'])
    .optional(),
});

export type ListPlansQuery = z.infer<typeof listPlansQuerySchema>;
