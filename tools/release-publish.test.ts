import { describe, expect, it } from 'vitest';
import { planPublish, type PublishInput } from './release-publish';

const SHA = 'a'.repeat(40);
const input = (over: Partial<PublishInput> = {}): PublishInput => ({
  head: '1.0.0',
  tagCommit: null,
  sha: SHA,
  release: 'none',
  ...over,
});

describe('planPublish', () => {
  it('skips while nothing is released', () => {
    expect(planPublish(input({ head: null })).action).toBe('skip');
  });

  it('creates tag and release for a new version', () => {
    expect(planPublish(input()).action).toBe('create');
  });

  it('completes a release whose tag is already on this commit', () => {
    expect(planPublish(input({ tagCommit: SHA })).action).toBe('create');
  });

  it('is done when tag and release exist on this commit', () => {
    expect(planPublish(input({ tagCommit: SHA, release: 'published' })).action).toBe('done');
  });

  it('fails when the tag is on another commit, released or not', () => {
    const other = 'b'.repeat(40);
    expect(planPublish(input({ tagCommit: other })).action).toBe('fail');
    expect(planPublish(input({ tagCommit: other, release: 'published' })).action).toBe('fail');
  });

  it('fails on a draft or a release without a tag', () => {
    expect(planPublish(input({ tagCommit: SHA, release: 'draft' })).action).toBe('fail');
    expect(planPublish(input({ release: 'published' })).action).toBe('fail');
  });
});
