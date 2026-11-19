import { expect, it } from 'vitest';
import { listenerPids } from '../e2e/preview-port';

it('reads each listener pid once and none when ss hides it', () => {
  const both =
    'LISTEN 0 511 127.0.0.1:4400 0.0.0.0:* users:(("node",pid=11,fd=19))\n' +
    'LISTEN 0 511 [::1]:4400 [::]:* users:(("node",pid=11,fd=20),("node",pid=12,fd=21))';
  expect(listenerPids(both)).toEqual([11, 12]);
  expect(listenerPids('LISTEN 0 511 127.0.0.1:4400 0.0.0.0:*')).toEqual([]);
});
