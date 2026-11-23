import { describe, expect, it } from 'vitest';
import { channelBuildState, channelNames, parseChannel, resolveChannel } from './channel';

describe('resolveChannel', () => {
  it('is production without a channel, whatever the base', () => {
    expect(resolveChannel(undefined, '/gegenlenker/')).toBe('production');
    expect(resolveChannel('', '/')).toBe('production');
  });

  it('accepts UAT only on a base that is its own subdirectory', () => {
    expect(resolveChannel('uat', '/gegenlenker/uat/')).toBe('uat');
    expect(() => resolveChannel('uat', '/gegenlenker/')).toThrow(/BASE_PATH/);
    expect(() => resolveChannel('uat', '/gegenlenker/uat')).toThrow(/BASE_PATH/);
  });

  it('rejects an unknown channel', () => {
    expect(() => resolveChannel('staging', '/gegenlenker/')).toThrow(/DEPLOY_CHANNEL/);
  });
});

describe('channel names', () => {
  it('keeps the production names stored data lives under', () => {
    expect(channelNames('production')).toEqual({
      storagePrefix: 'gegenlenker',
      runtimeCache: 'ground-texture',
      appName: 'Gegenlenker',
    });
  });

  it('shares no storage prefix or cache with production, and no prefix is a prefix of the other', () => {
    const prod = channelNames('production');
    const uat = channelNames('uat');
    expect(uat.runtimeCache).not.toBe(prod.runtimeCache);
    expect(`${uat.storagePrefix}.`.startsWith(`${prod.storagePrefix}.`)).toBe(false);
  });

  it('reads anything but uat as production', () => {
    expect(parseChannel('uat')).toBe('uat');
    expect(parseChannel(undefined)).toBe('production');
    expect(parseChannel('production')).toBe('production');
  });
});

describe('channelBuildState', () => {
  const state = { version: '1.2.3', release: true };

  it('shows a UAT build as a development build, even on a release tree', () => {
    expect(channelBuildState('uat', state).release).toBe(false);
  });

  it('leaves a production build alone', () => {
    expect(channelBuildState('production', state)).toBe(state);
  });
});
