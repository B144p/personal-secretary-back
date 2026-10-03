import { importPlanSchema } from '../dto/import-plan.dto';
import {
  MARKDOWN_MAX_DEPTH,
  MARKDOWN_MAX_TASKS,
  parsePlanMarkdown,
} from './markdown';

const titles = (tasks: { title: string; children?: unknown[] }[]): unknown =>
  tasks.map((t) =>
    t.children ? { [t.title]: titles(t.children as typeof tasks) } : t.title,
  );

describe('parsePlanMarkdown', () => {
  it('uses numbered steps under a Steps container, skipping Context and Verification', () => {
    const plan = parsePlanMarkdown(`# Plan: Tiny todo CLI

## Context
Why we build it.

## Steps

1. **Create todo.js with helpers**
   1. Add loadTodos() / saveTodos()
   2. Add a dispatcher
2. **Implement \`add <text>\`**
   - Join argv into the text
3. **Implement list**

## Verification
- node todo.js list
`);
    expect(plan.title).toBe('Tiny todo CLI');
    expect(titles(plan.tasks)).toEqual([
      {
        'Create todo.js with helpers': [
          'Add loadTodos() / saveTodos()',
          'Add a dispatcher',
        ],
      },
      'Implement add <text>',
      'Implement list',
    ]);
    expect(plan.tasks[1].description).toBe('- Join argv into the text');
  });

  it('turns numbered subsections under a container heading into tasks', () => {
    const plan = parsePlanMarkdown(`# Fuse cap

## Work

### 1. \`retrieval.service.ts\` — the fix
- change the LIMIT
- keep the order

### 2. Tests
Add a spec.

## Things to know
- nothing
`);
    expect(titles(plan.tasks)).toEqual([
      'retrieval.service.ts — the fix',
      'Tests',
    ]);
    expect(plan.tasks[0].description).toBe(
      '- change the LIMIT\n- keep the order',
    );
    expect(plan.tasks[1].description).toBe('Add a spec.');
  });

  it('keeps plain sections as tasks with their subsections and steps as children', () => {
    const plan = parsePlanMarkdown(`# Phase 2

## Backend
### 1. \`feat(db)\`: add status
- migration

## Frontend
9. \`feat(schemas)\`: add CANCELLED
10. \`feat(plan)\`:
    - badge

## Report
Publish the artifact.
`);
    expect(titles(plan.tasks)).toEqual([
      { Backend: ['feat(db): add status'] },
      { Frontend: ['feat(schemas): add CANCELLED', 'feat(plan)'] },
      'Report',
    ]);
    expect(plan.tasks[1].children?.[1].description).toBe('- badge');
  });

  it('skips only headings that are wholly a background name', () => {
    const plan = parsePlanMarkdown(`# T

## Context
why

## Step 2: Background sync worker
## 3. Testing harness setup
## Notes API
## Summary endpoint
## Files upload service

## Verification (manual)
- click it

## What exploration found (drives the order)
- stuff
`);
    expect(titles(plan.tasks)).toEqual([
      'Background sync worker',
      'Testing harness setup',
      'Notes API',
      'Summary endpoint',
      'Files upload service',
    ]);
  });

  it('ignores headings and lists inside code fences', () => {
    const plan = parsePlanMarkdown(`# T

## Do it
\`\`\`sh
# not a heading
1. not a step
\`\`\`
1. real step
`);
    expect(titles(plan.tasks)).toEqual([{ 'Do it': ['real step'] }]);
  });

  it('falls back to a single task named after the plan', () => {
    const plan = parsePlanMarkdown('Just fix the typo in the README.');
    expect(plan.title).toBe('Just fix the typo in the README.');
    expect(plan.tasks).toEqual([{ title: 'Just fix the typo in the README.' }]);
  });

  it('clamps depth and count so the result always passes the import schema', () => {
    const deep = Array.from(
      { length: 8 },
      (_, i) => `${'   '.repeat(i)}1. level ${i}`,
    ).join('\n');
    const wide = Array.from({ length: 150 }, (_, i) => `${i + 1}. step ${i}`);
    const plan = parsePlanMarkdown(
      `# Big\n\n## Deep\n${deep}\n\n## Wide\n${wide.join('\n')}`,
    );

    let depth = 0;
    let count = 0;
    const walk = (ts: typeof plan.tasks, d: number) =>
      ts.forEach((t) => {
        count++;
        depth = Math.max(depth, d);
        walk(t.children ?? [], d + 1);
      });
    walk(plan.tasks, 0);
    expect(depth).toBe(MARKDOWN_MAX_DEPTH);
    expect(count).toBe(MARKDOWN_MAX_TASKS);
    expect(importPlanSchema.safeParse(plan).success).toBe(true);
  });
});
