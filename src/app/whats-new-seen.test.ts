import { describe, expect, it } from 'vitest';
import { parseSeen, unseenAmong } from './whats-new-seen';

describe('parseSeen', () => {
  it('reads a list of ids', () => {
    expect(parseSeen('["1.added","2.fixed"]')).toEqual(new Set(['1.added', '2.fixed']));
    expect(parseSeen('[]')).toEqual(new Set());
  });

  it('drops non-string members', () => {
    expect(parseSeen('["1.added",2,null,{}]')).toEqual(new Set(['1.added']));
  });

  it('treats missing or unusable data as nothing stored', () => {
    for (const raw of [null, '', 'not json', '{"a":1}', '"1.added"', '7']) {
      expect(parseSeen(raw)).toBeNull();
    }
  });
});

describe('unseenAmong', () => {
  const ids = ['1.added', '2.fixed', '3.added'];

  it('flags only ids missing from the seen set', () => {
    expect(unseenAmong(ids, new Set(['1.added', '3.added']))).toEqual(['2.fixed']);
    expect(unseenAmong(ids, new Set(ids))).toEqual([]);
  });

  it('flags nothing on a first visit', () => {
    expect(unseenAmong(ids, null)).toEqual([]);
  });

  it('flags everything for an empty stored set', () => {
    expect(unseenAmong(ids, new Set())).toEqual(ids);
  });
});
