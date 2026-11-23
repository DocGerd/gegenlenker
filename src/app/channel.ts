import { channelNames, parseChannel } from '../pwa/channel';

/** Set by vite.config.ts from `DEPLOY_CHANNEL`; absent (tests, dev) means production. */
export const CHANNEL = parseChannel(import.meta.env['VITE_CHANNEL']);

export const NAMES = channelNames(CHANNEL);
