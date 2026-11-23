export type Channel = 'production' | 'uat';

/** The UAT build lives in this subdirectory of the production base. */
export const UAT_DIR = 'uat/';

/** Throws when `deployChannel` is not a channel, or UAT is built for a base that is not its own subdirectory. */
export function resolveChannel(deployChannel: string | undefined, base: string): Channel {
  if (deployChannel === undefined || deployChannel === '' || deployChannel === 'production')
    return 'production';
  if (deployChannel !== 'uat')
    throw new Error(`DEPLOY_CHANNEL must be "uat", got "${deployChannel}"`);
  if (!base.endsWith(`/${UAT_DIR}`))
    throw new Error(`a UAT build needs a BASE_PATH ending in "/${UAT_DIR}", got "${base}"`);
  return 'uat';
}

/** Anything but `uat` is production, so a build without a channel keeps the stored data. */
export const parseChannel = (value: unknown): Channel => (value === 'uat' ? 'uat' : 'production');

export interface ChannelNames {
  /** Prefix of every localStorage key: `<prefix>.<name>`. */
  storagePrefix: string;
  /** Runtime cache of the assets the default preset does not draw. */
  runtimeCache: string;
  appName: string;
}

/** Production names are what installed apps already store under: never change them. */
export const channelNames = (channel: Channel): ChannelNames =>
  channel === 'uat'
    ? {
        storagePrefix: 'gegenlenker-uat',
        runtimeCache: 'gegenlenker-uat-ground-texture',
        appName: 'Gegenlenker UAT',
      }
    : { storagePrefix: 'gegenlenker', runtimeCache: 'ground-texture', appName: 'Gegenlenker' };

export interface BuildState {
  version: string;
  release: boolean;
}

/** A UAT build is never a release: it always shows the development marker. */
export const channelBuildState = <T extends BuildState>(channel: Channel, state: T): T =>
  channel === 'uat' ? { ...state, release: false } : state;
