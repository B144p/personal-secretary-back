## Running Tests

Assume test tooling has roughly 4GB of RAM headroom to work with. `jest`/`npm test` is configured to run `--runInBand` with `maxWorkers: 2` as a fallback cap (see `package.json`) specifically because two overlapping full-suite runs once spawned ~14 worker processes and nearly froze the development machine (swap thrashing, not just CPU contention).

Before starting any `jest`/`npm test`/`npm run test:*` invocation, check whether a test run is already in flight (background job, monitor, or a foreground command still running) and wait for it or reuse its output instead of starting a second one. Never run two `jest` invocations concurrently in this project, even a full run plus a small targeted one to "check something quickly" — that exact pattern caused the incident above.
