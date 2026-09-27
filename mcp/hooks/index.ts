import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
// Both are dependency-free (no Nest, no Prisma), so this stays fast.
import { parsePlanMarkdown } from '../../src/plan/plan.import/markdown';
import { createApi } from '../api';
import { planSummary, type PlanOut } from '../tools';

// Claude Code hooks that save plan-mode plans to Personal Secretary without
// relying on Claude to remember. Run through ./run.sh <event>.
//
//   stash       PreToolUse  ExitPlanMode   plan submitted → keep it as pending
//   approved    PostToolUse ExitPlanMode   plan approved  → send it
//   first-edit  PreToolUse  Edit|Write|…   work started (e.g. after ESC) → send
//   create-pre  PreToolUse  create_plan    already sent → deny the duplicate
//   create-post PostToolUse create_plan    Claude saved it → mark as sent
//
// A hook must never get in Claude's way: every failure is logged and the
// process exits 0. stdout is only used for the JSON Claude Code reads.

interface HookInput {
  session_id: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: { plan?: unknown; planFilePath?: unknown };
  tool_response?: unknown;
}

interface Pending {
  plan: string;
  hash: string;
  cwd: string;
  stashed_at: string;
}

interface Sent {
  hash: string;
  plan_id: string | null;
  via: 'hook' | 'create_plan';
  sent_at: string;
}

const STATE_DIR =
  process.env.PM_HOOK_STATE_DIR ?? join(homedir(), '.claude', 'personal-pm');
const PENDING_DIR = join(STATE_DIR, 'pending');
const SENT_DIR = join(STATE_DIR, 'sent');
const LOG_FILE = join(STATE_DIR, 'hook.log');
const PLANS_DIR = join(homedir(), '.claude', 'plans');
const STALE_MS = 7 * 24 * 3600 * 1000;

const log = (message: string) => {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Nowhere left to report; never fail the hook over logging.
  }
};

// Session ids come from Claude Code, but keep them safe as file names.
const fileFor = (dir: string, sessionId: string) =>
  join(dir, `${sessionId.replace(/[^\w-]/g, '_')}.json`);

const readJson = <T>(path: string): T | null => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
};

const writeJson = (path: string, value: unknown) => {
  mkdirSync(join(path, '..'), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, path);
};

const remove = (path: string) => {
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
};

const hashPlan = (plan: string) =>
  createHash('sha256').update(plan.trim()).digest('hex').slice(0, 16);

const output = (event: 'PreToolUse' | 'PostToolUse', extra: object) =>
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: event, ...extra },
    }),
  );

// The plan text is in tool_input.plan. Fall back to the file Claude Code
// writes in plan mode, if the payload ever stops carrying it.
const planFromInput = (input: HookInput): string | null => {
  const { plan, planFilePath } = input.tool_input ?? {};
  if (typeof plan === 'string' && plan.trim()) return plan;
  const candidates =
    typeof planFilePath === 'string'
      ? [planFilePath]
      : existsSync(PLANS_DIR)
        ? readdirSync(PLANS_DIR)
            .filter((f) => f.endsWith('.md'))
            .map((f) => join(PLANS_DIR, f))
            .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
            .slice(0, 1)
        : [];
  for (const path of candidates) {
    try {
      // Only trust a recent file: it must be the plan just submitted.
      if (Date.now() - statSync(path).mtimeMs > 10 * 60 * 1000) continue;
      const text = readFileSync(path, 'utf8');
      if (text.trim()) return text;
    } catch {
      // unreadable, try the next
    }
  }
  return null;
};

// git origin URL → repo root → cwd, as agreed for source_id.
const sourceIdFor = (cwd: string) => {
  for (const args of [
    ['remote', 'get-url', 'origin'],
    ['rev-parse', '--show-toplevel'],
  ]) {
    try {
      const out = execFileSync('git', ['-C', cwd, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
      }).trim();
      if (out) return out;
    } catch {
      // not a repo / no origin
    }
  }
  return cwd;
};

const cleanupStale = () => {
  for (const dir of [PENDING_DIR, SENT_DIR]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      const path = join(dir, f);
      try {
        if (Date.now() - statSync(path).mtimeMs > STALE_MS) remove(path);
      } catch {
        // raced with another session
      }
    }
  }
};

const stash = (input: HookInput, plan: string) => {
  const pending: Pending = {
    plan,
    hash: hashPlan(plan),
    cwd: input.cwd ?? process.cwd(),
    stashed_at: new Date().toISOString(),
  };
  writeJson(fileFor(PENDING_DIR, input.session_id), pending);
  return pending;
};

const send = async (sessionId: string, pending: Pending) => {
  const baseUrl = process.env.PM_API_URL;
  const token = process.env.PM_TOKEN;
  if (!baseUrl || !token) {
    log(`skip send ${sessionId}: PM_API_URL / PM_TOKEN not set`);
    return null;
  }
  const { title, tasks } = parsePlanMarkdown(pending.plan);
  const api = createApi({ baseUrl, token, timeoutMs: 10_000 });
  const plan = await api.post<PlanOut>('/plan/import', {
    title,
    source_id: sourceIdFor(pending.cwd),
    tasks,
    import_key: `${sessionId}:${pending.hash}`,
  });
  const sent: Sent = {
    hash: pending.hash,
    plan_id: plan.id,
    via: 'hook',
    sent_at: new Date().toISOString(),
  };
  writeJson(fileFor(SENT_DIR, sessionId), sent);
  remove(fileFor(PENDING_DIR, sessionId));
  log(`sent ${sessionId} → plan ${plan.id}`);
  return plan;
};

const savedContext = (plan: PlanOut) =>
  [
    `Saved as Personal Secretary plan automatically (plan hook). Do not call personal-pm create_plan for this plan.`,
    `While implementing, call personal-pm update_task_status as steps start (IN_PROGRESS), finish (DONE) or turn out unnecessary (CANCELLED, with the reason as note), and add_task for new steps.`,
    planSummary(plan),
  ].join('\n');

const handlers: Record<string, (input: HookInput) => void | Promise<void>> = {
  // Plan submitted. Nothing is sent yet: the user may still say "No, keep
  // planning", press ESC, or approve.
  stash: (input) => {
    cleanupStale();
    const plan = planFromInput(input);
    if (!plan) return log(`stash ${input.session_id}: no plan text found`);
    const pending = stash(input, plan);
    log(`stashed ${input.session_id} (${pending.hash})`);
  },

  // Plan approved. Send now so Claude gets the task ids before editing.
  approved: async (input) => {
    const path = fileFor(PENDING_DIR, input.session_id);
    const plan = planFromInput(input);
    // Also covers a missed stash: the approved payload carries the plan too.
    const pending =
      plan && readJson<Pending>(path)?.hash !== hashPlan(plan)
        ? stash(input, plan)
        : readJson<Pending>(path);
    if (!pending) return log(`approved ${input.session_id}: nothing pending`);
    const saved = await send(input.session_id, pending);
    if (saved)
      output('PostToolUse', { additionalContext: savedContext(saved) });
  },

  // First edit of the session with a plan still pending, i.e. the user
  // dismissed the prompt (ESC, switched model/mode) and then said go.
  'first-edit': async (input) => {
    const pending = readJson<Pending>(fileFor(PENDING_DIR, input.session_id));
    if (!pending) return;
    const saved = await send(input.session_id, pending);
    // Context only, no permissionDecision: the edit still goes through the
    // user's normal approval (manual mode must keep asking).
    if (saved) output('PreToolUse', { additionalContext: savedContext(saved) });
  },

  // The hook already saved this session's plan and nothing newer is pending.
  'create-pre': (input) => {
    if (existsSync(fileFor(PENDING_DIR, input.session_id))) return;
    const sent = readJson<Sent>(fileFor(SENT_DIR, input.session_id));
    if (!sent) return;
    output('PreToolUse', {
      permissionDecision: 'deny',
      permissionDecisionReason: `This plan was already saved to Personal Secretary as plan ${sent.plan_id} (${sent.via}). Do not save it again; use get_plan with that id to see its task ids.`,
    });
  },

  // Claude saved the pending plan itself (ESC path): its structured task list
  // wins, and the first-edit hook must not send a second copy.
  'create-post': (input) => {
    const path = fileFor(PENDING_DIR, input.session_id);
    const pending = readJson<Pending>(path);
    if (!pending) return;
    const response = JSON.stringify(input.tool_response ?? '');
    if (!response.includes('Created.')) return; // tool returned an error
    const planId = /id ([0-9a-f-]{36})/.exec(response)?.[1] ?? null;
    writeJson(fileFor(SENT_DIR, input.session_id), {
      hash: pending.hash,
      plan_id: planId,
      via: 'create_plan',
      sent_at: new Date().toISOString(),
    } satisfies Sent);
    remove(path);
    log(`create_plan saved ${input.session_id} → plan ${planId}`);
  },
};

const main = async () => {
  const event = process.argv[2] ?? '';
  const handler = handlers[event];
  const raw = readFileSync(0, 'utf8');
  if (process.env.PM_HOOK_DEBUG === '1') log(`payload ${event}: ${raw}`);
  if (!handler) return log(`unknown hook event "${event}"`);
  const input = JSON.parse(raw) as HookInput;
  if (!input.session_id) return log(`${event}: payload has no session_id`);
  await handler(input);
};

main()
  .catch((err: unknown) =>
    log(`${process.argv[2]} failed: ${(err as Error).message}`),
  )
  .finally(() => process.exit(0));
