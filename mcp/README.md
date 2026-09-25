# personal-pm MCP server

A stdio MCP server that lets Claude Code save the plan it writes into
Personal Secretary. It is a thin HTTP client for the backend: no Nest, no
Prisma, no DB connection.

| Tool | What it does | Backend |
|---|---|---|
| `whoami` | Checks the connection and which account the token belongs to | `GET /me` |
| `list_plans` | Lists plans (optionally only Claude Code ones) | `GET /plan` |
| `create_plan` | Saves an approved plan as a DRAFT plan with nested tasks | `POST /plan/import` |

Plans created this way are tagged `CLAUDE_CODE`. They **never call OpenAI and
never book calendar events**; the backend also rejects `re_generate` and
scheduling for them.

## Setup

1. Start the backend: `npm run start:dev`.
2. Mint a token for your account. It is printed once, so copy it:
   ```sh
   npm run create-pat -- you@example.com claude-cli
   ```
3. Register the server with Claude Code (user scope, so it's available in every repo):
   ```sh
   claude mcp add personal-pm --scope user \
     -e PM_API_URL=http://localhost:3000 \
     -e PM_TOKEN=psk_... \
     -- npx --prefix /abs/path/to/personal-secretary-back tsx /abs/path/to/personal-secretary-back/mcp/index.ts
   ```
   Use your backend's real port for `PM_API_URL`.
4. In Claude Code, run `/mcp`. `personal-pm` should show as connected with 3 tools.
   Then ask Claude to "call whoami".

To revoke the token: `npm run revoke-pat -- you@example.com claude-cli`.

## Saving plans automatically after plan mode

Phase 1 relies on an instruction rather than a hook. Add this to
`~/.claude/CLAUDE.md`:

```md
## Personal Secretary
After I approve a plan (plan mode), call the `personal-pm` `create_plan` tool:
title = short feature name, tasks = the plan's steps in order (sub-steps as
children), source_id = output of `git remote get-url origin` (or the repo path).
```

A hook on `ExitPlanMode` that makes this fully automatic is planned for phase 2.

## Development

- `npm run mcp:dev` runs the server directly. It waits for MCP JSON-RPC on stdin.
- Logs go to **stderr** only, because stdout carries the protocol.
- `mcp/` is excluded from `nest build` (`tsconfig.build.json`) and doesn't
  affect `dist/`.
