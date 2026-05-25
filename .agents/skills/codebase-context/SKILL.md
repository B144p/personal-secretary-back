---
name: codebase-context
description: >
  Generates a comprehensive overall_context.md file that summarizes a codebase
  for handoff to another AI agent. Use this skill whenever the user asks to
  "summarize the codebase", "create a context file for another agent", "write an
  overview for a new agent", "document the project for handoff", or anything
  along the lines of capturing the current state of a repo so a fresh agent can
  pick up where things left off. Trigger this skill even if the user only loosely
  phrases it — e.g. "explain the codebase in a file", "make an overview.md",
  "summarize everything into a doc for someone else". The output is always a
  single markdown file (overall_context.md) at the project root.
---

# Codebase Context Skill

Generate a single `overall_context.md` at the project root that gives a fresh AI agent (or a human) enough context to understand the codebase, contribute to it, and know where active development is happening — without needing to read every file themselves.

## Why this matters

The file will be pasted directly into another agent's context window. Everything that agent needs to avoid wrong assumptions should be in this file. Err on the side of completeness for decisions/design choices that aren't obvious from the code.

---

## Step 1 — Orient yourself

Run these before reading individual files:

```bash
find . -type f \( -name "*.ts" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.js" -o -name "*.tsx" \) | grep -v node_modules | grep -v .git | sort
```

Also check for: `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `*.prisma`, `docker-compose.yml`, `Makefile`, `.env.example`, `README.md`, `CLAUDE.md`.

---

## Step 2 — Read strategically

Read files in this priority order. You don't need to read every line of every file — focus on structure and interfaces.

1. **Entry points** — `main.ts`, `main.py`, `cmd/`, `app.go`, etc.
2. **Module/package structure** — how the code is organized at the top level
3. **Controllers / routers / handlers** — what HTTP (or other) endpoints exist
4. **Services / use-cases** — what each service is responsible for
5. **Data models** — database schema (`*.prisma`, `models.py`, `*.go` structs, etc.)
6. **DTOs / request schemas** — what inputs are validated
7. **LLM / AI integration** — prompts, schemas, model names, output validation
8. **External API integrations** — which services, how auth is handled
9. **Utility / shared code** — retry logic, validators, shared helpers
10. **Config / env** — `.env.example`, config modules
11. **Infrastructure** — `docker-compose.yml`, `Dockerfile`, `Makefile`
12. **In-progress work** — look for `TODO`, `FIXME`, commented-out code, stub implementations that return placeholder data

---

## Step 3 — Write overall_context.md

Write the file with this structure. Adapt section depth to the project's complexity — don't add empty sections.

```markdown
# <Project Name> — Overall Context

> **Context source:** <Backend / Frontend / Monorepo / etc.>
> **Stack:** <key technologies>
> **Branch:** <current branch>
> **Date captured:** <today's date>

---

## What This Project Does
One paragraph: purpose, who uses it, the core user-facing flow.

---

## Module / Package Map
Annotated tree or table showing top-level modules and their single-sentence purpose.

---

## API Endpoints
Table per router/controller group. Include method, path, auth requirement, one-line description.

---

## Core Services / Components
For each service/component: what it owns, its key methods, any non-obvious design choices.

---

## Database Schema
Models table (name, key fields, purpose). Enums. Important relations.

---

## External Integrations
For each integration (LLM, OAuth, third-party APIs): what it does, how auth works, key config values, any constraints (rate limits, model names, working hours, etc.).

---

## Key Utilities
Table: utility name | location | purpose.

---

## Infrastructure
Port, Docker setup, env vars required (grouped by concern).

---

## In-Progress / Known TODOs
Table: location | description. Include stubs, commented-out code, placeholder returns, unfilled template variables.
```

---

## Step 4 — Label and finalize

- Add the context source label at the top (e.g. `> **Context source:** Backend`)
- Add today's date
- Add the current git branch if you can get it (`git branch --show-current`)
- Write to `overall_context.md` at the project root (overwrite if it exists)
- Confirm to the user: "Written to `overall_context.md` — ready to feed to another agent."

---

## Quality checklist

Before finishing, verify the file answers these questions without the reader having to look at any source code:

- [ ] What does this project do in plain language?
- [ ] What are all the HTTP endpoints and what do they accept/return?
- [ ] What is the database schema (models + enums)?
- [ ] Which LLM model is used and what are the prompt constraints?
- [ ] How does authentication work end-to-end?
- [ ] What environment variables are required?
- [ ] What is currently broken, stubbed, or in-progress?
