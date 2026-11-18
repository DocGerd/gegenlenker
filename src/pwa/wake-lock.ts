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

  const acquire = (): void => {
    if (released || pending || sentinel !== null || doc.visibilityState !== 'visible') return;
    pending = true;
    api
      .request('screen')
      .then((lock) => {
        if (released) {
          void lock.release().catch(() => undefined);
          return;
        }
        sentinel = lock;
        lock.addEventListener('release', () => {
          if (sentinel === lock) sentinel = null;
        });
      })
      .catch((error: unknown) => console.warn('Screen wake lock unavailable', error))
      .finally(() => {
        pending = false;
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
    void lock?.release().catch(() => undefined);
  };
}
