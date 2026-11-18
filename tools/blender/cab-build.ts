import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = join(import.meta.dirname, '../..');

export const CAB_FILES = {
  script: 'tools/blender/cab_shell.py',
  params: 'tools/blender/params/man-le-18-280.cab.json',
  glb: 'src/render/assets/man-le-18-280-cab.glb',
  manifest: 'src/render/assets/man-le-18-280-cab.manifest.json',
} as const;

export type CabManifest = {
  readonly scriptSha256: string;
  readonly paramsSha256: string;
  readonly blenderVersion: string;
  readonly gltfTransformVersion: string;
  readonly glbSha256: string;
  readonly glbBytes: number;
};

export const sha256 = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

/** Line endings differ per checkout, so the script is hashed LF-normalised. */
export const scriptSha256 = (root = ROOT): string =>
  sha256(readFileSync(join(root, CAB_FILES.script), 'utf8').replaceAll('\r\n', '\n'));

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

/** Sorted keys, no whitespace: formatting and key order cannot change the hash. */
export function canonicalJson(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const paramsSha256 = (root = ROOT): string =>
  sha256(canonicalJson(JSON.parse(readFileSync(join(root, CAB_FILES.params), 'utf8')) as Json));

export const glbSha256 = (root = ROOT): string => sha256(readFileSync(join(root, CAB_FILES.glb)));
