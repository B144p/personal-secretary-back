import { listPlansQuerySchema } from './list-plans.dto';

describe('listPlansQuerySchema', () => {
  it('accepts no params', () => {
    expect(listPlansQuerySchema.parse({})).toEqual({});
  });

  it('parses open as a boolean and keeps the filters', () => {
    expect(
      listPlansQuerySchema.parse({
        repo_key: 'github.com/me/repo',
        open: 'true',
        source_type: 'CLAUDE_CODE',
      }),
    ).toEqual({
      repo_key: 'github.com/me/repo',
      open: true,
      source_type: 'CLAUDE_CODE',
    });
    expect(listPlansQuerySchema.parse({ open: 'false' })).toEqual({
      open: false,
    });
  });

  it('rejects unknown values', () => {
    expect(listPlansQuerySchema.safeParse({ open: 'yes' }).success).toBe(false);
    expect(
      listPlansQuerySchema.safeParse({ source_type: 'OTHER' }).success,
    ).toBe(false);
  });
});
