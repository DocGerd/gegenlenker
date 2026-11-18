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
