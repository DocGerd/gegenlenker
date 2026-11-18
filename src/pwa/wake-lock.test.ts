import { describe, expect, it, vi, type Mock } from 'vitest';
import { holdWakeLock, type VisibilityHost, type WakeLockHost } from './wake-lock';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type FakeLock = EventTarget & { release: Mock<() => Promise<void>> };

function setup(request?: () => Promise<FakeLock>) {
  const locks: FakeLock[] = [];
  const state: { visibilityState: DocumentVisibilityState } = { visibilityState: 'visible' };
  const doc = Object.assign(new EventTarget(), state);
  const api = {
    request: vi.fn(
      request ??
        (() => {
          const lock = Object.assign(new EventTarget(), {
            release: vi.fn(() => Promise.resolve()),
          });
          locks.push(lock);
          return Promise.resolve(lock);
        }),
    ),
  };
  const host: WakeLockHost = { wakeLock: api };
  const visibility = doc as unknown as VisibilityHost;
  const show = (state: DocumentVisibilityState) => {
    doc.visibilityState = state;
    doc.dispatchEvent(new Event('visibilitychange'));
  };
  return { api, host, visibility, locks, show };
}

describe('holdWakeLock', () => {
  it('does nothing where the API is missing', () => {
    const { visibility } = setup();
    expect(() => holdWakeLock({}, visibility)()).not.toThrow();
  });

  it('acquires on start and releases on stop', async () => {
    const { api, host, visibility, locks } = setup();
    const stop = holdWakeLock(host, visibility);
    await flush();
    expect(api.request).toHaveBeenCalledOnce();
    stop();
    expect(locks[0]?.release).toHaveBeenCalledOnce();
  });

  it('re-acquires when the page returns after the browser dropped the lock', async () => {
    const { api, host, visibility, locks, show } = setup();
    holdWakeLock(host, visibility);
    await flush();
    show('hidden');
    locks[0]?.dispatchEvent(new Event('release'));
    show('visible');
    await flush();
    expect(api.request).toHaveBeenCalledTimes(2);
  });

  it('does not request again while a lock is held or the page is hidden', async () => {
    const { api, host, visibility, show } = setup();
    holdWakeLock(host, visibility);
    await flush();
    show('visible');
    show('hidden');
    await flush();
    expect(api.request).toHaveBeenCalledOnce();
  });

  it('releases a lock that resolves after stop', async () => {
    const { host, visibility, locks } = setup();
    const stop = holdWakeLock(host, visibility);
    stop();
    await flush();
    expect(locks[0]?.release).toHaveBeenCalledOnce();
  });

  it('warns and carries on when the request is refused', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { host, visibility } = setup(() => Promise.reject(new Error('denied')));
    expect(() => holdWakeLock(host, visibility)).not.toThrow();
    await flush();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
