import { execFileSync } from 'node:child_process';
import { normalizeRepoKey } from '../src/plan/repo-key';

// Where a Claude Code session is working, for the plan hooks and
// get_repo_context. Plain git, 3 s per call, never throws.

const git = (cwd: string, args: string[]) => {
  try {
    return (
      execFileSync('git', ['-C', cwd, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
      }).trim() || null
    );
  } catch {
    return null; // not a repo / no origin / git missing
  }
};

export interface RepoInfo {
  // Raw origin URL, else repo root, else cwd: what source_id has always held.
  source_id: string;
  // Normalized key, or null outside a git repo.
  repo_key: string | null;
  // null on a detached HEAD or outside a repo.
  branch: string | null;
}

export const repoInfo = (cwd: string): RepoInfo => {
  const origin = git(cwd, ['remote', 'get-url', 'origin']);
  const root = origin ? null : git(cwd, ['rev-parse', '--show-toplevel']);
  const head =
    origin || root ? git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']) : null;
  const remoteOrRoot = origin ?? root;
  return {
    source_id: remoteOrRoot ?? cwd,
    repo_key: remoteOrRoot ? normalizeRepoKey(remoteOrRoot) : null,
    branch: head && head !== 'HEAD' ? head : null,
  };
};

// The import fields for a plan made in this repo; undefined keys are dropped
// by JSON, so a session outside git only sends source_id.
export const sessionRepo = (info: RepoInfo) => ({
  source_id: info.source_id,
  repo_key: info.repo_key ?? undefined,
  branch: info.branch ?? undefined,
});
