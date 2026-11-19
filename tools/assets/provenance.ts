import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { read } from 'ktx-parse';

export const ROOT = join(import.meta.dirname, '../..');

/** The ktx2 key/value entry that carries the hash of the inputs a texture was built from. */
export const KV_INPUTS = 'gegenlenker.inputsSha256';

export type Json =
  null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export const sha256 = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

/** Line endings differ per checkout, so sources are hashed LF-normalised. */
export const lfText = (root: string, file: string): string =>
  readFileSync(join(root, file), 'utf8').replaceAll('\r\n', '\n');

export const fileSha256 = (root: string, file: string): string => sha256(lfText(root, file));

/** Sorted keys, no whitespace: formatting and key order cannot change the hash. */
export function canonicalJson(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The string value of a ktx2 key/value entry, without its NUL terminator. */
export function readKv(ktx2: Uint8Array, key: string): string | undefined {
  const value = read(ktx2).keyValue[key];
  return value instanceof Uint8Array ? new TextDecoder().decode(value).replace(/\0$/, '') : value;
}

export function encoderVersion(root = ROOT): string {
  const file = join(root, 'node_modules/ktx2-encoder/package.json');
  return (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version;
}
