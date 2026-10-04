import { normalizeRepoKey } from './repo-key';

describe('normalizeRepoKey', () => {
  it.each([
    [
      'git@github.com:B144p/personal-secretary-back.git',
      'github.com/B144p/personal-secretary-back',
    ],
    [
      'https://github.com/B144p/personal-secretary-back.git',
      'github.com/B144p/personal-secretary-back',
    ],
    [
      'https://github.com/B144p/personal-secretary-back',
      'github.com/B144p/personal-secretary-back',
    ],
    ['ssh://git@github.com/B144p/repo.git', 'github.com/B144p/repo'],
    [
      'https://token@gitlab.com/group/sub/repo.git/',
      'gitlab.com/group/sub/repo',
    ],
    ['  git@github.com:a/b.git\n', 'github.com/a/b'],
  ])('normalizes remote %s', (raw, expected) => {
    expect(normalizeRepoKey(raw)).toBe(expected);
  });

  it('keeps a repo root path, minus trailing slashes', () => {
    expect(normalizeRepoKey('/Users/me/code/app/')).toBe('/Users/me/code/app');
    expect(normalizeRepoKey('/Users/me/code/app')).toBe('/Users/me/code/app');
  });

  it('never returns an empty key', () => {
    expect(normalizeRepoKey('/')).toBe('/');
  });
});
