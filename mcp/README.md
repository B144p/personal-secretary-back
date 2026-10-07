# personal-pm MCP server

A stdio MCP server plus Claude Code hooks. Together they let Claude Code save
the plan it writes into Personal Secretary and report what actually happened
to each step. The server is a thin HTTP client for the backend: no Nest, no
Prisma, no DB connection.

| Tool | What it does | Backend |
|---|---|---|
| `whoami` | Checks the connection and which account the token belongs to | `GET /me` |
| `list_plans` | Lists plans, most recently active first; filters: Claude Code only, `repo_key`, open only | `GET /plan?source_type=&repo_key=&open=` |
| `create_plan` | Saves a plan-mode plan as a DRAFT plan with nested tasks, tagged with the session's repo and branch (optional `parent_plan_id`) | `POST /plan/import` |
| `get_plan` | One plan's task tree with ids, statuses and notes | `GET /plan/:id` |
| `update_task_status` | PENDING / IN_PROGRESS / DONE / CANCELLED (reason required) | `PATCH /plan/:id/tasks/:taskId/status` |
| `add_task` | Adds a step found mid-work, with the reason | `POST /plan/:id/tasks` |
| `get_repo_context` | The open plan of the session's repo: open steps, cancelled reasons, other open plans | `GET /context?repo_key=&branch=` |
| `get_today` | The user's day(s): plan steps, calendar events, slipped steps, Claude Code work in progress | `GET /agenda?date=&days=` |
| `get_progress` | Percent done, slipped steps, next session, planned finish per plan | `GET /progress`, `GET /plan/:id/progress` |
| `report_progress` *(agent)* | Status changes on the scheduled plan; the backend repacks what is left | `PATCH /plan-progress` |
| `reschedule` *(agent)* | Moves slipped and remaining steps to the next free slots | `POST /plan-progress/reschedule` |
| `create_agent_plan` *(agent)* | DRAFT `AGENT` plan with an estimate on every step | `POST /plan/import` |
| `schedule_plan` *(agent)* | Books a DRAFT or READY plan into Google Calendar; names the plan holding the slot if another one is scheduled | `PATCH /plan/:id/schedule` |

Plans created this way are tagged `CLAUDE_CODE`. They **never call OpenAI and
never book calendar events**; the backend also rejects `re_generate` and
scheduling for them. Task status updates only apply to `CLAUDE_CODE` plans.
Parents and the plan follow automatically: closing a parent closes its open
sub-tasks, a parent is DONE once all its children are DONE/CANCELLED, and the
plan moves DRAFT → READY on the first update and to DONE when every top-level
task is closed.

## Profiles

`PM_MCP_PROFILE` picks the tools. Calendar-changing tools only exist where you
opt in, so coding sessions keep the rule "never books calendar events".

| Profile | Tools |
|---|---|
| `claude-code` (default) | `whoami`, `list_plans`, `get_plan`, `get_today`, `get_progress`, `create_plan`, `update_task_status`, `add_task`, `get_repo_context` |
| `agent` | `whoami`, `list_plans`, `get_plan`, `get_today`, `get_progress`, `report_progress`, `reschedule`, `create_agent_plan`, `schedule_plan` |
| `all` | both |

Register the agent profile as a second server, ideally with its own token
(`pnpm create-pat <email> chief`), so tool names stay distinct:

```sh
claude mcp add pm-agent --scope user -e PM_MCP_PROFILE=agent -- /abs/path/personal-secretary-back/mcp/run.sh
```

Calls that book or move events wait up to 120 s, like the web app.

## Setup

1. Start the backend: `npm run start:dev`.
2. Mint a token for your account. It is printed once, so copy it:
   ```sh
   npm run create-pat -- you@example.com claude-cli
   # with pnpm, drop the "--": pnpm create-pat you@example.com claude-cli
   ```
   The token lives in whichever DB `DATABASE_URL` points at, so a dev token
   doesn't work against production. For production, run it once with the
   production `DATABASE_URL`.
3. Create `mcp/.env` (gitignored) from `mcp/.env.example`:
   ```sh
   PM_API_URL=http://localhost:8000
   PM_TOKEN=psk_...
   ```
4. Register the server with Claude Code (user scope, so it's available in every repo).
   You only need to do this once:
   ```sh
   claude mcp add personal-pm --scope user -- /abs/path/to/personal-secretary-back/mcp/run.sh
   ```
5. In Claude Code, run `/mcp`. `personal-pm` should show as connected with 6 tools.
   Then ask Claude to "call whoami".

To switch between dev and production, edit `mcp/.env` and start a new Claude
session; there's no need to re-register. `run.sh` runs the code from this
checkout, so keep it on `main`.

Without `mcp/.env`, `run.sh` uses `PM_API_URL` / `PM_TOKEN` from the
environment instead, e.g. `claude mcp add personal-pm --scope user -e PM_API_URL=... -e PM_TOKEN=... -- .../mcp/run.sh`.

To revoke the token: `npm run revoke-pat -- you@example.com claude-cli`.

## Saving plans from plan mode (hooks)

The hooks in `mcp/hooks/` save every plan-mode plan without relying on Claude
to remember:

| When | Hook | What happens |
|---|---|---|
| Claude submits the plan | `PreToolUse` `ExitPlanMode` → `stash` | Plan kept locally as *pending* for this session |
| You approve it | `PostToolUse` `ExitPlanMode` → `approved` | Pending plan is sent; Claude gets the plan and task ids |
| You press ESC (or switch model/mode), then say go | `PreToolUse` `Edit\|Write\|MultiEdit\|NotebookEdit` → `first-edit` | Pending plan is sent before the first edit |
| Claude calls `create_plan` anyway | `PreToolUse`/`PostToolUse` `create_plan` | Denied if it repeats the saved plan (same title, or within 15 minutes of the save); a different plan goes through. On the ESC path Claude's list is used and the hook won't send again |
| "No, keep planning" | – | Claude revises the plan file (plan-mode edits never trigger a send); the next submission replaces the pending plan |
| A session starts, resumes, clears or compacts | `SessionStart` → `session-start` | The open plan of this repo (same branch first, else the most recently active) is added to Claude's context in at most 15 lines. Nothing is shown outside git or when no plan is open |

Details:

- The plan text is turned into tasks by `src/plan/plan.import/markdown.ts`:
  sections become tasks, numbered steps become sub-tasks, and bullets become
  descriptions. Context and Verification sections are skipped.
- `source_id` is the repo's git origin URL (or repo root, or cwd).
  `repo_key` is the same remote normalized (`git@github.com:a/b.git` and
  `https://github.com/a/b` both become `github.com/a/b`, see
  `src/plan/repo-key.ts`), and `branch` is the current branch.
- A `Parent plan: <plan id>` line in the plan links a follow-up plan to the
  earlier one; it is not turned into a task.
- Plans idle for 14 days are left out of the session-start block (it says how
  many); a daily job (03:00) puts Claude Code plans idle for 30 days on HOLD.
  The session-start block still counts held plans, and any step update or
  `add_task` on a held plan (or Reopen in the web app) makes it READY again.
  `import_key` is `<session_id>:<plan hash>`, so a retry never duplicates a
  plan, and a new plan in the same session creates a new one.
- Hooks never block Claude. Failures go to `~/.claude/personal-pm/hook.log`
  and the plan stays pending until the next edit. State lives in
  `~/.claude/personal-pm/{pending,sent}/` and is cleaned after 7 days.
- `first-edit` starts node only when the session has a pending plan, so
  ordinary edits aren't slowed down. It never approves an edit for you.
- `PM_HOOK_DEBUG=1` logs every raw hook payload to `hook.log`.
- Hooks send to the backend in `mcp/.env`, the same one as the MCP server.

### Install

Merge `mcp/hooks/settings.example.json` into `~/.claude/settings.json`,
replacing `/abs/path/to/personal-secretary-back` with this checkout's
absolute path, and keeping any hooks you already have. Start a new Claude
session afterwards; hooks load at session start.

### CLAUDE.md

The hooks cover saving. Add this to `~/.claude/CLAUDE.md` so Claude also
reports progress:

```md
## Personal Secretary
Plan-mode plans are saved to Personal Secretary automatically by the
personal-pm hooks. When "Saved as Personal Secretary plan" appears, use
that plan; don't call create_plan. If it never appears (hooks not
installed) and you are about to implement a plan-mode plan, call
personal-pm create_plan once, before any file edit.
While implementing, call personal-pm update_task_status: IN_PROGRESS when
you start a step, DONE when it is finished, CANCELLED with the reason as
note when a step turns out unnecessary. Use add_task only for steps you
discover while implementing the current plan. A new feature or new
requirement is not a new step: it needs a new plan in plan mode. Outside
plan mode, don't create plans or add tasks for it. When planning a
follow-up, you may call get_plan on the earlier plan to see what is done,
cancelled or still open.
A "Personal PM: open plan in this repo" block at session start is the plan
to resume: use its step ids for update_task_status.
```

To skip the first-use permission prompt for these tools, add to
`~/.claude/settings.json`:

```json
{ "permissions": { "allow": ["mcp__personal-pm__get_plan", "mcp__personal-pm__update_task_status", "mcp__personal-pm__add_task", "mcp__personal-pm__create_plan", "mcp__personal-pm__list_plans", "mcp__personal-pm__get_repo_context"] } }
```

## Development

- `npm run mcp:dev` runs the server directly. It waits for MCP JSON-RPC on stdin.
  It does not load `mcp/.env`; `mcp/run.sh` does.
- Logs go to **stderr** only, because stdout carries the protocol.
- `mcp/` is excluded from `nest build` (`tsconfig.build.json`) and doesn't
  affect `dist/`.
