# personal-pm MCP server

A stdio MCP server plus Claude Code hooks. Together they let Claude Code save
the plan it writes into Personal Secretary and report what actually happened
to each step. The server is a thin HTTP client for the backend: no Nest, no
Prisma, no DB connection.

| Tool | What it does | Backend |
|---|---|---|
| `whoami` | Checks the connection and which account the token belongs to | `GET /me` |
| `list_plans` | Lists plans (optionally only Claude Code ones) | `GET /plan` |
| `create_plan` | Saves a plan-mode plan as a DRAFT plan with nested tasks | `POST /plan/import` |
| `get_plan` | One plan's task tree with ids, statuses and notes | `GET /plan/:id` |
| `update_task_status` | PENDING / IN_PROGRESS / DONE / CANCELLED (reason required) | `PATCH /plan/:id/tasks/:taskId/status` |
| `add_task` | Adds a step found mid-work, with the reason | `POST /plan/:id/tasks` |

Plans created this way are tagged `CLAUDE_CODE`. They **never call OpenAI and
never book calendar events**; the backend also rejects `re_generate` and
scheduling for them. Task status updates only apply to `CLAUDE_CODE` plans.
Parents and the plan follow automatically: closing a parent closes its open
sub-tasks, a parent is DONE once all its children are DONE/CANCELLED, and the
plan moves DRAFT → READY on the first update and to DONE when every top-level
task is closed.

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
| Claude calls `create_plan` anyway | `PreToolUse`/`PostToolUse` `create_plan` | Denied if already saved; otherwise its list is used and the hook won't send again |
| "No, keep planning" | – | Claude revises; the next submission replaces the pending plan |

Details:

- The plan text is turned into tasks by `src/plan/plan.import/markdown.ts`:
  sections become tasks, numbered steps become sub-tasks, and bullets become
  descriptions. Context and Verification sections are skipped.
- `source_id` is the repo's git origin URL (or repo root, or cwd).
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
note when a step turns out unnecessary. Use add_task for new steps you
discover.
```

To skip the first-use permission prompt for these tools, add to
`~/.claude/settings.json`:

```json
{ "permissions": { "allow": ["mcp__personal-pm__get_plan", "mcp__personal-pm__update_task_status", "mcp__personal-pm__add_task", "mcp__personal-pm__create_plan"] } }
```

## Development

- `npm run mcp:dev` runs the server directly. It waits for MCP JSON-RPC on stdin.
  It does not load `mcp/.env`; `mcp/run.sh` does.
- Logs go to **stderr** only, because stdout carries the protocol.
- `mcp/` is excluded from `nest build` (`tsconfig.build.json`) and doesn't
  affect `dist/`.
