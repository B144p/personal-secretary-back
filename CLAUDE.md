@requirements/INDEX.md

## Known Warnings

- `prisma/schema.prisma` — `url = env("DATABASE_URL")` shows a warning in the IDE (VS Code Prisma extension). This is a false positive: the extension cannot resolve the env var because `.env` is gitignored and not present in the workspace. `DATABASE_URL` is defined at runtime via `.env` and Prisma 6.x (`^6.19.1`) still fully supports `env()` in the datasource block — it is not deprecated. The app migrates and runs correctly. Do not attempt to change or fix this.
