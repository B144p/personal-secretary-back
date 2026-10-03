import { updateTaskStatusSchema } from './update-task-status.dto';

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
