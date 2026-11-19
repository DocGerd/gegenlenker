import { expect, it } from 'vitest';
import { listenerPids, previewPort } from '../e2e/preview-port';

it('reads each listener pid once and none when ss hides it', () => {
  const both =
    'LISTEN 0 511 127.0.0.1:4400 0.0.0.0:* users:(("node",pid=11,fd=19))\n' +
    'LISTEN 0 511 [::1]:4400 [::]:* users:(("node",pid=11,fd=20),("node",pid=12,fd=21))';
  expect(listenerPids(both)).toEqual([11, 12]);
  expect(listenerPids('LISTEN 0 511 127.0.0.1:4400 0.0.0.0:*')).toEqual([]);
});

it('derives a stable port per checkout, E2E_PORT wins, and a bad one throws', () => {
  const a = previewPort('/work/a', {});
  expect(a).toBe(previewPort('/work/a', {}));
  expect(a).not.toBe(previewPort('/work/b', {}));
  expect(previewPort('/work/a', { E2E_PORT: '5000' })).toBe(5000);
  expect(() => previewPort('/work/a', { E2E_PORT: '80' })).toThrow('E2E_PORT');
});
