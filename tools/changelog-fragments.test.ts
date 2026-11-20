import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inlineProblem, parseFragment } from '../src/app/changelog-entries';
import { fragmentFiles } from './changelog';

const DIR = join(import.meta.dirname, '..', 'changelog.d');
const GOOD = '([#7](https://github.com/DocGerd/gegenlenker/pull/7))';
const okay = `Fixes it ${GOOD}.\n`;

describe('changelog fragments', () => {
  it('has the format README', () => {
    expect(existsSync(join(DIR, 'README.md'))).toBe(true);
  });

  it('parses a good fragment', () => {
    expect(parseFragment('7.fixed.md', okay)).toEqual({
      id: '7.fixed',
      category: 'fixed',
      prs: [7],
      en: 'Fixes it.',
    });
    expect(parseFragment('7-2.added.md', `Adds it ${GOOD}`).id).toBe('7-2.added');
  });

  it.each([
    ['name', '7.bug.md', okay, /bad file name/],
    ['two lines', '7.fixed.md', `${okay}Extra.\n`, /exactly one non-empty line/],
    ['no text', '7.fixed.md', '\n', /exactly one non-empty line/],
    ['list marker', '7.fixed.md', `- Fixes it ${GOOD}.`, /starts like a list/],
    ['heading', '7.fixed.md', `# Fixes it ${GOOD}.`, /starts like a list/],
    ['missing link', '7.fixed.md', 'Fixes it.', /end with its PR link/],
    ['other number', '8.fixed.md', okay, /differs from the file name/],
    ['markup', '7.fixed.md', `Fixes **it** ${GOOD}.`, /markup/],
  ])('rejects %s', (_label, name, text, message) => {
    expect(() => parseFragment(name, text)).toThrow(message);
  });

  it('limits text to plain text and inline code', () => {
    expect(inlineProblem('Uses `?probe` here.')).toBeNull();
    expect(inlineProblem('Uses `a_b` here.')).toBeNull();
    for (const bad of [
      'Bold **x**.',
      'Italic *x*.',
      'Tag <b>x</b>.',
      'Link [x](https://example.com).',
      'Escape \\*.',
      'Open `code.',
      '1. Item.',
      '> Quote.',
      'Emphasis _x_ here.',
      'Struck ~~x~~ here.',
      'Entity &amp; here.',
      'See https://example.com here.',
    ])
      expect(inlineProblem(bad), bad).not.toBeNull();
  });

  // Zero fragments is valid: right after a release the directory holds only README.md and released.json.
  it.each(fragmentFiles(DIR))('%s is a well-formed fragment', (file) => {
    expect(() => parseFragment(file, readFileSync(join(DIR, file), 'utf8'))).not.toThrow();
  });
});
