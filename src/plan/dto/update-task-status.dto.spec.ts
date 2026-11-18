import {
  BULK_TASK_STATUS_MAX_NOTE,
  BULK_TASK_STATUS_MAX_UPDATES,
  bulkUpdateTaskStatusSchema,
  formatBulkTaskStatusError,
  updateTaskStatusSchema,
} from './update-task-status.dto';

describe('bulkUpdateTaskStatusSchema', () => {
  const parse = (updates: unknown) =>
    bulkUpdateTaskStatusSchema.safeParse({ updates });

  it('accepts a mixed list', () => {
    expect(
      parse([
        { task_id: 't1', status: 'DONE' },
        { task_id: 't2', status: 'CANCELLED', note: 'not needed' },
      ]).success,
    ).toBe(true);
  });

  it('rejects an empty list and a list over the limit', () => {
    expect(parse([]).success).toBe(false);
    const tooMany = Array.from(
      { length: BULK_TASK_STATUS_MAX_UPDATES + 1 },
      (_, i) => ({ task_id: `t${i}`, status: 'DONE' }),
    );
    expect(parse(tooMany).success).toBe(false);
  });

  it('rejects the same task listed twice', () => {
    const r = parse([
      { task_id: 't1', status: 'IN_PROGRESS' },
      { task_id: 't1', status: 'DONE' },
    ]);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toContain('t1');
  });

  it('requires a non-empty note for CANCELLED and names the task', () => {
    const missing = parse([{ task_id: 't1', status: 'CANCELLED' }]);
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0]?.message).toContain('t1');
    const blank = parse([{ task_id: 't1', status: 'CANCELLED', note: '   ' }]);
    expect(blank.success).toBe(false);
    expect(blank.error?.issues[0]?.message).toContain('t1');
  });

  it('reports every bad entry in one message, with its position', () => {
    const r = parse([
      { task_id: 't1', status: 'CANCELLED' },
      { task_id: 't2', status: 'DONE' },
      { task_id: 't3', status: 'HOLD' },
      { task_id: 't4', status: 'CANCELLED', note: '  ' },
    ]);
    const message = formatBulkTaskStatusError(r.error!);
    expect(message).toContain('Update 1 (note)');
    expect(message).toContain('cancelling task t1');
    expect(message).toContain('Update 3 (status)');
    expect(message).toContain('Update 4 (note)');
    expect(message).toContain('cancelling task t4');
    expect(message).not.toContain('Update 2');
  });

  it('rejects a note over the limit', () => {
    const note = 'x'.repeat(BULK_TASK_STATUS_MAX_NOTE + 1);
    expect(parse([{ task_id: 't1', status: 'DONE', note }]).success).toBe(
      false,
    );
  });

  it('keeps the largest valid list under the 100 KB body limit', () => {
    const updates = Array.from(
      { length: BULK_TASK_STATUS_MAX_UPDATES },
      (_, i) => ({
        task_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        status: 'IN_PROGRESS',
        note: 'ก'.repeat(BULK_TASK_STATUS_MAX_NOTE),
      }),
    );
    expect(parse(updates).success).toBe(true);
    expect(Buffer.byteLength(JSON.stringify({ updates }))).toBeLessThan(
      100 * 1024,
    );
  });

  it('treats a blank note as no note on other statuses', () => {
    const r = parse([{ task_id: 't1', status: 'DONE', note: '   ' }]);
    expect(r.success).toBe(true);
    expect(r.data?.updates[0]?.note).toBeUndefined();
  });

  it('rejects HOLD, which belongs to the calendar flow', () => {
    expect(parse([{ task_id: 't1', status: 'HOLD' }]).success).toBe(false);
  });
});

describe('updateTaskStatusSchema', () => {
  it('requires a note when cancelling', () => {
    expect(
      updateTaskStatusSchema.safeParse({ status: 'CANCELLED' }).success,
    ).toBe(false);
    expect(
      updateTaskStatusSchema.safeParse({
        status: 'CANCELLED',
        note: 'not needed',
      }).success,
    ).toBe(true);
  });

  it('rejects HOLD, which belongs to the calendar flow', () => {
    expect(updateTaskStatusSchema.safeParse({ status: 'HOLD' }).success).toBe(
      false,
    );
  });
});
