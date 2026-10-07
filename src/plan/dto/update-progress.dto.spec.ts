import { updateProgressSchema } from './update-progress.dto';

describe('updateProgressSchema', () => {
  it('accepts the web form body and defaults statusChanges', () => {
    expect(updateProgressSchema.parse({ contextText: ' tired ' })).toEqual({
      statusChanges: [],
      contextText: 'tired',
    });
    expect(
      updateProgressSchema.parse({
        statusChanges: [{ taskId: 't1', newStatus: 'DONE' }],
      }).statusChanges,
    ).toHaveLength(1);
  });

  it('rejects CANCELLED, an empty task id and oversized input', () => {
    const bad = [
      { statusChanges: [{ taskId: 't1', newStatus: 'CANCELLED' }] },
      { statusChanges: [{ taskId: '', newStatus: 'DONE' }] },
      { contextText: 'x'.repeat(2001) },
      {
        statusChanges: Array.from({ length: 101 }, (_, i) => ({
          taskId: `t${i}`,
          newStatus: 'DONE',
        })),
      },
    ];
    for (const body of bad)
      expect(updateProgressSchema.safeParse(body).success).toBe(false);
  });
});
