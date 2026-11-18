import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPersistentStorage } from './persist';

function stubStorage(persisted: () => Promise<boolean>, persist: () => Promise<boolean>) {
  const storage = { persisted: vi.fn(persisted), persist: vi.fn(persist) };
  vi.stubGlobal('navigator', { storage });
  return storage;
}

describe('requestPersistentStorage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks for persistence when the origin is not persistent yet', async () => {
    const storage = stubStorage(
      () => Promise.resolve(false),
      () => Promise.resolve(true),
    );
    await requestPersistentStorage();
    expect(storage.persist).toHaveBeenCalledOnce();
  });

  it('does not ask again once persistent', async () => {
    const storage = stubStorage(
      () => Promise.resolve(true),
      () => Promise.resolve(true),
    );
    await requestPersistentStorage();
    expect(storage.persist).not.toHaveBeenCalled();
  });

  it('swallows a browser that rejects the request', async () => {
    stubStorage(
      () => Promise.resolve(false),
      () => Promise.reject(new Error('denied')),
    );
    await expect(requestPersistentStorage()).resolves.toBeUndefined();
  });

  it('does nothing without the storage API', async () => {
    vi.stubGlobal('navigator', {});
    await expect(requestPersistentStorage()).resolves.toBeUndefined();
  });
});
