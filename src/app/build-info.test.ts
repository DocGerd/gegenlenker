import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { releaseState } from '../../tools/changelog';
import { describeBuild } from './build-info';

const ROOT = new URL('../..', import.meta.url).pathname;

describe('describeBuild', () => {
  it('shows the package version of a release build and no commit', () => {
    const label = describeBuild({ ...releaseState(ROOT), release: true, commit: 'abc1234' });
    expect(label).toContain(pkg.version);
    expect(label).not.toContain('abc1234');
  });

  it('shows the commit of any other build, never the version', () => {
    const label = describeBuild({ ...releaseState(ROOT), release: false, commit: 'abc1234' });
    expect(label).toContain('abc1234');
    expect(label).not.toContain(pkg.version);
  });
});
