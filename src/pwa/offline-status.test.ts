import { afterEach, describe, expect, it, vi } from 'vitest';
import { failOnRedundantInstall, offlineStatus, setOfflineStatus } from './offline-status';

function worker() {
  const init: { state: ServiceWorkerState } = { state: 'installing' };
  return Object.assign(new EventTarget(), init);
}

function redundant(w: ReturnType<typeof worker>): void {
  w.state = 'redundant';
  w.dispatchEvent(new Event('statechange'));
}

describe('failOnRedundantInstall', () => {
  afterEach(() => {
    setOfflineStatus('unknown');
    vi.restoreAllMocks();
  });

  it('reports failed when an uncontrolled first install goes redundant', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const w = worker();
    failOnRedundantInstall({ installing: w }, () => false);
    redundant(w);
    expect(offlineStatus()).toBe('failed');
  });

  it('ignores a redundant update worker while a controller exists', () => {
    const w = worker();
    failOnRedundantInstall({ installing: w }, () => true);
    redundant(w);
    expect(offlineStatus()).toBe('unknown');
  });

  it('keeps ready when the precache already completed', () => {
    const w = worker();
    failOnRedundantInstall({ installing: w }, () => false);
    setOfflineStatus('ready');
    redundant(w);
    expect(offlineStatus()).toBe('ready');
  });
});
