// Turns a plan-mode plan (markdown) into the import shape, for the plan hook,
// which only has the plan text. Dependency-free on purpose: the hook runs it
// through tsx without booting Nest, Prisma or zod.
//
// Rules, in short:
// - The first `# ` heading is the title (without a leading "Plan:").
// - Sections are nested by heading level. Background sections (Context,
//   Verification, Notes, ...) are skipped.
// - A section becomes a task. Container headings (Steps, Commits, Work, ...)
//   are flattened so their subsections / steps become the tasks instead.
// - Ordered list items are steps → child tasks. Bullets and paragraphs are
//   details → the task description.
// - A "Parent plan: <uuid>" line links a follow-up plan to the earlier one.
//   It is metadata, so it is removed before the tasks are built.

export const MARKDOWN_MAX_DEPTH = 4; // depth 0..4, matches IMPORT_MAX_DEPTH
export const MARKDOWN_MAX_TASKS = 100; // matches IMPORT_MAX_TASKS
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2000;

export interface MarkdownTask {
  title: string;
  description?: string;
  children?: MarkdownTask[];
}

export interface ParsedMarkdownPlan {
  title: string;
  tasks: MarkdownTask[];
  parent_plan_id?: string;
}

// "Parent plan: <uuid>", optionally as a bullet, bold or in backticks.
const PARENT_PLAN_LINE =
  /^\s*(?:[-*+]\s+)?(?:\*\*|__)?parent plan(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*`?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`?.*$/i;

const takeParentPlan = (markdown: string) => {
  let parentPlanId: string | undefined;
  let inFence = false;
  const lines = markdown.split('\n').filter((line) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence && PARENT_PLAN_LINE.exec(line);
    if (!m) return true;
    parentPlanId ??= m[1].toLowerCase();
    return false;
  });
  return { markdown: lines.join('\n'), parentPlanId };
};

// Background sections, matched against the whole heading (plus an optional
// "(...)" qualifier) so work sections that merely start with one of these
// words ("Notes API", "Summary endpoint", "Background sync worker") stay.
const SKIP_NAMES = [
  'context',
  'background',
  'overview',
  'summary',
  'verification',
  'verify',
  'test plan',
  'how to (test|verify)',
  '(critical|key|relevant) files',
  'files( to (change|modify|touch))?',
  'notes?',
  'things to know',
  'risks?',
  'accepted cost',
  'what .*found',
  'out of scope',
  'open questions',
  'decisions?( made)?',
  'scope',
  'assumptions',
  'references?',
  'non-goals',
  'left open',
  'later',
  'future( work)?',
  'follow[- ]?ups?',
  'next steps?',
];
const SKIP_SECTION = new RegExp(
  `^(?:${SKIP_NAMES.join('|')})(?:\\s*\\([^)]*\\))?$`,
  'i',
);
const CONTAINER_SECTION =
  /^(steps|work|commits|implementation( steps| plan)?|plan|tasks|changes|approach|execution|order of work|todo)$/i;

interface ListItem {
  indent: number;
  ordered: boolean;
  lines: string[];
  items: ListItem[];
}

interface Section {
  level: number;
  heading: string;
  body: string[];
  sections: Section[];
}

const clean = (s: string) =>
  s
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*(step\s+)?\d+[.):]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/:$/, '');

const clip = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;

const parseSections = (markdown: string): Section => {
  const root: Section = { level: 0, heading: '', body: [], sections: [] };
  const stack: Section[] = [root];
  let inFence = false;
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence && /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const section: Section = {
        level: h[1].length,
        heading: h[2],
        body: [],
        sections: [],
      };
      while (stack[stack.length - 1].level >= section.level) stack.pop();
      stack[stack.length - 1].sections.push(section);
      stack.push(section);
    } else {
      stack[stack.length - 1].body.push(line);
    }
  }
  return root;
};

// Paragraph lines plus a list tree. Continuation lines join the open item.
const parseBody = (body: string[]) => {
  const paragraphs: string[] = [];
  const top: ListItem[] = [];
  const open: ListItem[] = [];
  let inFence = false;
  for (const line of body) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || /^\s*\|/.test(line)) continue; // code and tables: skip
    const m = /^(\s*)(\d+[.)]|[-*+])\s+(.*)$/.exec(line);
    if (m) {
      const item: ListItem = {
        indent: m[1].length,
        ordered: /\d/.test(m[2]),
        lines: [m[3]],
        items: [],
      };
      while (open.length && open[open.length - 1].indent >= item.indent)
        open.pop();
      (open.length ? open[open.length - 1].items : top).push(item);
      open.push(item);
      continue;
    }
    if (!line.trim()) continue;
    const indent = /^\s*/.exec(line)![0].length;
    while (open.length && open[open.length - 1].indent >= indent) open.pop();
    if (open.length) open[open.length - 1].lines.push(line.trim());
    else {
      paragraphs.push(line.trim());
    }
  }
  return { paragraphs, items: top };
};

const bulletText = (items: ListItem[], indent = ''): string[] =>
  items.flatMap((i) => [
    `${indent}- ${i.lines.join(' ')}`,
    ...bulletText(i.items, `${indent}  `),
  ]);

const describe = (lines: string[]) => {
  const text = lines.join('\n').trim();
  return text ? clip(text, MAX_DESCRIPTION) : undefined;
};

const itemToTask = (item: ListItem): MarkdownTask => {
  const [first, ...rest] = item.lines;
  // "**Title** — details" → the bold part is the title.
  const bold = /^\*\*(.+?)\*\*[\s:—–-]*(.*)$/.exec(first);
  // Otherwise a long first line keeps its first sentence as the title.
  const sentence =
    !bold && first.length > 120 && /^(.+?[.!?])\s+(.+)$/.exec(first);
  const title = bold ? bold[1] : sentence ? sentence[1] : first;
  const extra = bold?.[2] ? [bold[2]] : sentence ? [sentence[2]] : [];
  const steps = item.items.filter((i) => i.ordered);
  const details = item.items.filter((i) => !i.ordered);
  return {
    title: clip(clean(title), MAX_TITLE),
    description: describe([...extra, ...rest, ...bulletText(details)]),
    children: steps.map(itemToTask),
  };
};

const sectionToTasks = (section: Section): MarkdownTask[] => {
  const heading = clean(section.heading);
  if (SKIP_SECTION.test(heading)) return [];
  const { paragraphs, items } = parseBody(section.body);
  const steps = items.filter((i) => i.ordered).map(itemToTask);
  const bullets = items.filter((i) => !i.ordered);
  const subtasks = section.sections.flatMap(sectionToTasks);

  if (section.level <= 1 || CONTAINER_SECTION.test(heading)) {
    return [...steps, ...subtasks];
  }
  if (!heading) return [];
  return [
    {
      title: clip(heading, MAX_TITLE),
      description: describe([...paragraphs, ...bulletText(bullets)]),
      children: [...subtasks, ...steps],
    },
  ];
};

// Enforce the import limits: drop levels past the max depth, stop at the max
// count (depth-first, so earlier steps win), and strip empty fields.
const limit = (tasks: MarkdownTask[]): MarkdownTask[] => {
  let count = 0;
  const walk = (nodes: MarkdownTask[], depth: number): MarkdownTask[] => {
    const out: MarkdownTask[] = [];
    for (const n of nodes) {
      if (count >= MARKDOWN_MAX_TASKS || !n.title) continue;
      count++;
      const children =
        depth < MARKDOWN_MAX_DEPTH ? walk(n.children ?? [], depth + 1) : [];
      out.push({
        title: n.title,
        ...(n.description && { description: n.description }),
        ...(children.length > 0 && { children }),
      });
    }
    return out;
  };
  return walk(tasks, 0);
};

export const parsePlanMarkdown = (source: string): ParsedMarkdownPlan => {
  const { markdown, parentPlanId } = takeParentPlan(
    source.replace(/\r\n/g, '\n'),
  );
  const root = parseSections(markdown);
  const h1 = root.sections.find((s) => s.level === 1);
  const firstLine = markdown.split('\n').find((l) => l.trim()) ?? '';
  const title = clip(
    clean(h1?.heading ?? firstLine.replace(/^#+\s*/, '')).replace(
      /^plan\s*[:\-—–]\s*/i,
      '',
    ) || 'Claude Code plan',
    MAX_TITLE,
  );

  let tasks = limit(root.sections.flatMap(sectionToTasks));
  if (tasks.length === 0) {
    // Nothing recognisable: fall back to every ordered list in the document.
    tasks = limit(
      parseBody(markdown.split('\n'))
        .items.filter((i) => i.ordered)
        .map(itemToTask),
    );
  }
  if (tasks.length === 0) tasks = [{ title }];
  return {
    title,
    tasks,
    ...(parentPlanId && { parent_plan_id: parentPlanId }),
  };
};
