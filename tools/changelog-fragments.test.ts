import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(import.meta.dirname, '..', 'changelog.d');
const NAME_RE = /^\d+(?:-\d+)?\.(?:added|changed|deprecated|removed|fixed|security)\.md$/;
const HEADING_RE = /^#{1,6}(?:\s|$)/;

const opensWithHeading = (body: string): boolean => {
  const first = body.split('\n').find((line) => line.trim() !== '');
  return first !== undefined && HEADING_RE.test(first.trim());
};

describe('changelog fragments', () => {
  it('detects a leading heading and tolerates a leading dash', () => {
    expect(opensWithHeading('\n### Fixed\nBody.')).toBe(true);
    expect(opensWithHeading('- Body.')).toBe(false);
    expect(opensWithHeading('Fixes #1.')).toBe(false);
  });

  const fragments = readdirSync(DIR).filter((f) => f !== 'README.md');

  it.each(fragments)('%s is named <number>.<category>.md and has no heading', (file) => {
    expect(file).toMatch(NAME_RE);
    const body = readFileSync(join(DIR, file), 'utf8');
    expect(body.trim()).not.toBe('');
    expect(opensWithHeading(body)).toBe(false);
  });
});
