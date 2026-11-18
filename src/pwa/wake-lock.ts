type Sentinel = EventTarget & { release(): Promise<void> };

export type WakeLockHost = {
  readonly wakeLock?: { request(type: 'screen'): Promise<Sentinel> };
};

export type VisibilityHost = Pick<
  Document,
  'visibilityState' | 'addEventListener' | 'removeEventListener'
>;

/** Keeps the screen on until the returned release is called; the browser drops the lock when the page is hidden, so it is re-requested on return. */
export function holdWakeLock(
  host: WakeLockHost = navigator,
  doc: VisibilityHost = document,
): () => void {
  const api = host.wakeLock;
  if (api === undefined) return () => undefined;

  let released = false;
  let pending = false;
  let sentinel: Sentinel | null = null;
  // A visibility change that arrives while a request is in flight is retried once it settles.
  let again = false;

  const releaseQuietly = (lock: Sentinel): void => {
    lock.release().catch((error: unknown) => console.debug('Wake lock release failed', error));
  };
  const acquire = (): void => {
    if (released || sentinel !== null || doc.visibilityState !== 'visible') return;
    if (pending) {
      again = true;
      return;
    }
    pending = true;
    api
      .request('screen')
      .then((lock) => {
        if (released) {
          releaseQuietly(lock);
          return;
        }
        sentinel = lock;
        lock.addEventListener('release', () => {
          console.debug('Wake lock released by the browser');
          if (sentinel === lock) sentinel = null;
        });
      })
      .catch((error: unknown) => console.warn('Screen wake lock unavailable', error))
      .finally(() => {
        pending = false;
        if (!again) return;
        again = false;
        acquire();
      });
  };
  doc.addEventListener('visibilitychange', acquire);
  acquire();

  return () => {
    if (released) return;
    released = true;
    doc.removeEventListener('visibilitychange', acquire);
    const lock = sentinel;
    sentinel = null;
    if (lock !== null) releaseQuietly(lock);
  };
}
