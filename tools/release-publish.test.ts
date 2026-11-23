import { describe, expect, it } from 'vitest';
import { planPublish, type ListedRelease, type PublishInput } from './release-publish';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const published = (tagName: string): ListedRelease => ({ tagName, isDraft: false });
const draft = (tagName: string): ListedRelease => ({ tagName, isDraft: true });
const input = (over: Partial<PublishInput> = {}): PublishInput => ({
  head: '1.0.0',
  tagCommit: null,
  sha: SHA,
  releases: [],
  ...over,
});

describe('planPublish', () => {
  it('skips while nothing is released', () => {
    expect(planPublish(input({ head: null })).action).toBe('skip');
  });

  it('creates tag and release for a new version as Latest', () => {
    expect(planPublish(input({ releases: [published('v0.9.0')] }))).toMatchObject({
      action: 'create',
      latest: true,
    });
  });

  it('completes a release whose tag is already on this commit', () => {
    expect(planPublish(input({ tagCommit: SHA })).action).toBe('create');
  });

  it('keeps Latest on a higher published version, but not on a higher draft', () => {
    expect(planPublish(input({ releases: [published('v1.1.0')] }))).toMatchObject({
      action: 'create',
      latest: false,
    });
    expect(planPublish(input({ releases: [draft('v1.1.0')] }))).toMatchObject({
      action: 'create',
      latest: true,
    });
  });

  it('is done when tag and release exist on this commit', () => {
    expect(planPublish(input({ tagCommit: SHA, releases: [published('v1.0.0')] })).action).toBe(
      'done',
    );
  });

  it('fails when the tag is on another commit, whatever the release', () => {
    for (const releases of [[], [published('v1.0.0')], [draft('v1.0.0')]])
      expect(planPublish(input({ tagCommit: OTHER, releases })).action).toBe('fail');
  });

  it('fails on a draft, tagged or not, and on a release without a tag', () => {
    expect(planPublish(input({ releases: [draft('v1.0.0')] })).action).toBe('fail');
    expect(planPublish(input({ tagCommit: SHA, releases: [draft('v1.0.0')] })).action).toBe('fail');
    expect(planPublish(input({ releases: [published('v1.0.0')] })).action).toBe('fail');
  });
});
