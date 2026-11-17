export async function requestPersistentStorage(): Promise<void> {
  if (!('storage' in navigator)) return;
  try {
    if (!(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // Best effort: a refusal only means the browser may evict stored runs under pressure.
  }
}
