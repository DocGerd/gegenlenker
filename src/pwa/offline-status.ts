export type OfflineStatus = 'unknown' | 'ready' | 'failed';

let status: OfflineStatus = 'unknown';
const listeners = new Set<() => void>();

export function offlineStatus(): OfflineStatus {
  return status;
}

export function setOfflineStatus(next: OfflineStatus): void {
  if (next === status) return;
  status = next;
  for (const listener of listeners) listener();
}

/** Returns the unsubscribe. */
export function onOfflineStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

type InstallHost = {
  readonly installing: Pick<ServiceWorker, 'state' | 'addEventListener'> | null;
};

/** A first install that goes redundant fires neither onOfflineReady nor onRegisterError. */
export function failOnRedundantInstall(registration: InstallHost, controlled: () => boolean): void {
  const worker = registration.installing;
  if (worker === null || controlled()) return;
  worker.addEventListener('statechange', () => {
    if (worker.state !== 'redundant' || controlled() || status === 'ready') return;
    console.error('Service worker install failed');
    setOfflineStatus('failed');
  });
}
