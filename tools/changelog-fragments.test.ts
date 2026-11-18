import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(import.meta.dirname, '..', 'changelog.d');
const NAME_RE =
  /^([1-9]\d*)(?:-[1-9]\d*)?\.(?:added|changed|deprecated|removed|fixed|security)\.md$/;
const BULLET_RE = /^[-*+]\s/;
const HEADING_RE = /^#{1,6}(?:\s|$)/;
const LINK_RE = /\(\[#(\d+)\]\(https:\/\/github\.com\/DocGerd\/gegenlenker\/pull\/(\d+)\)\)\.?$/;

const problems = (file: string, body: string): string[] => {
  const out: string[] = [];
  const lines = body.split('\n').filter((line) => line.trim() !== '');
  if (lines.length !== 1) return [`expected one non-empty line, got ${String(lines.length)}`];
  const line = lines[0]?.trim() ?? '';
  if (BULLET_RE.test(line)) out.push('leading list marker');
  if (HEADING_RE.test(line)) out.push('heading');
  const link = LINK_RE.exec(line);
  const number = NAME_RE.exec(file)?.[1];
  if (!link) out.push('missing trailing PR link');
  else if (link[1] !== link[2] || link[1] !== number)
    out.push('PR link number differs from filename');
  return out;
};

const GOOD = '([#7](https://github.com/DocGerd/gegenlenker/pull/7))';

describe('changelog fragments', () => {
  it('has the format README', () => {
    expect(existsSync(join(DIR, 'README.md'))).toBe(true);
  });

  it('flags bad fragment content', () => {
    expect(problems('7.fixed.md', `Fixes it ${GOOD}.\n`)).toEqual([]);
    expect(problems('7.fixed.md', `Fixes it ${GOOD}`)).toEqual([]);
    expect(problems('7.fixed.md', `- Fixes it ${GOOD}.`)).toContain('leading list marker');
    expect(problems('7.fixed.md', `### Fixed\n${GOOD}`)).toHaveLength(1);
    expect(problems('7.fixed.md', `# Fixed ${GOOD}`)).toContain('heading');
    expect(problems('7.fixed.md', 'No link.')).toContain('missing trailing PR link');
    expect(problems('8.fixed.md', `Fixes it ${GOOD}.`)).toContain(
      'PR link number differs from filename',
    );
  });

  // Zero fragments is valid: right after a release the directory holds only README.md.
  const fragments = readdirSync(DIR).filter((f) => f !== 'README.md');

  it.each(fragments)('%s is a well-formed fragment', (file) => {
    expect(file).toMatch(NAME_RE);
    expect(problems(file, readFileSync(join(DIR, file), 'utf8'))).toEqual([]);
  });
});
