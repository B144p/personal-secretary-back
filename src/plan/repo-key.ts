// Pure module, also imported by mcp/ — keep it free of Nest and Prisma.
//
// A plan's repo identity: the git origin URL without scheme, user or ".git",
// so the ssh and https remotes of one repo match. Anything that is not a
// remote URL (a repo root path) is kept as is, minus trailing slashes.
// The backfill in migration 20261004120000_add_plan_repo_context applies
// the same rules in SQL.
export const normalizeRepoKey = (raw: string): string => {
  const key = raw
    .trim()
    .replace(/^[a-z+]+:\/\/([^@/]+@)?/, '') // https://, ssh://git@
    .replace(/^[^@/]+@([^:/]+):/, '$1/') // git@github.com:owner/repo
    .replace(/\.git\/?$/, '')
    .replace(/\/+$/, '');
  return key || raw.trim();
};
