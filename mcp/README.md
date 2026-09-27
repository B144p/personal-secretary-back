# personal-pm MCP server

A stdio MCP server that lets Claude Code save the plan it writes into
Personal Secretary. It is a thin HTTP client for the backend: no Nest, no
Prisma, no DB connection.

| Tool | What it does | Backend |
|---|---|---|
| `whoami` | Checks the connection and which account the token belongs to | `GET /me` |
| `list_plans` | Lists plans (optionally only Claude Code ones) | `GET /plan` |
| `create_plan` | Saves a plan-mode plan as a DRAFT plan with nested tasks | `POST /plan/import` |

Plans created this way are tagged `CLAUDE_CODE`. They **never call OpenAI and
never book calendar events**; the backend also rejects `re_generate` and
scheduling for them.

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
5. In Claude Code, run `/mcp`. `personal-pm` should show as connected with 3 tools.
   Then ask Claude to "call whoami".

To switch between dev and production, edit `mcp/.env` and start a new Claude
session; there's no need to re-register. `run.sh` runs the code from this
checkout, so keep it on `main`.

Without `mcp/.env`, `run.sh` uses `PM_API_URL` / `PM_TOKEN` from the
environment instead, e.g. `claude mcp add personal-pm --scope user -e PM_API_URL=... -e PM_TOKEN=... -- .../mcp/run.sh`.

To revoke the token: `npm run revoke-pat -- you@example.com claude-cli`.

## Saving plans from plan mode

Phase 1 relies on instructions rather than a hook. The main instruction is in
the `create_plan` tool description, which Claude sees in every session where
this server is connected: call the tool **once per plan, before any file
edit**. This applies both when you approve the plan and when you dismiss the
prompt (ESC, switch model or mode) and then say go ahead.

As a reminder, also add this to `~/.claude/CLAUDE.md` (user level, so it
applies in every repo):

```md
## Personal Secretary
Before you start implementing a plan written in plan mode, call the
`personal-pm` `create_plan` tool exactly once, before any file edit.
Do this whether I approved the plan at the prompt, or dismissed the prompt
(ESC, switched model or mode) and then told you to go ahead.
title = short feature name, tasks = the plan's steps in order (sub-steps as
children), source_id = output of `git remote get-url origin` (or the repo path).
Don't call it again for the same plan.
```

In auto-accept mode, only file edits are auto-approved; MCP tools still ask
the first time. To skip that prompt, add to `~/.claude/settings.json`:

```json
{ "permissions": { "allow": ["mcp__personal-pm__create_plan"] } }
```

This is still an instruction, so Claude can occasionally skip it. The phase 2
hook makes saving guaranteed.

## Development

- `npm run mcp:dev` runs the server directly. It waits for MCP JSON-RPC on stdin.
  It does not load `mcp/.env`; `mcp/run.sh` does.
- Logs go to **stderr** only, because stdout carries the protocol.
- `mcp/` is excluded from `nest build` (`tsconfig.build.json`) and doesn't
  affect `dist/`.
