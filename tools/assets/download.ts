import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { sha256 } from './provenance';
import type { SourceFile } from './sources';

export type Fetcher = (url: string) => Promise<Uint8Array>;

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** The named member of a zip, read through its central directory. */
export function zipMember(zip: Uint8Array, member: string): Uint8Array {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = zip.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== EOCD) end--;
  if (end < 0) throw new Error('not a zip archive');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== CENTRAL) throw new Error('corrupt zip directory');
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (name !== member) continue;
    if (view.getUint32(local, true) !== LOCAL) throw new Error('corrupt zip entry');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = zip.subarray(start, start + size);
    if (method === 0) return data;
    if (method === 8) return new Uint8Array(inflateRawSync(data));
    throw new Error(`${member}: unsupported zip method ${method}`);
  }
  throw new Error(`${member} is not in the archive`);
}

/**
 * Downloads each file to its uncommitted path unless it is already there with the registered
 * hash. A file whose bytes do not match is never written; every failure is named in one error.
 */
export async function downloadSources(
  files: readonly SourceFile[],
  root: string,
  fetcher: Fetcher,
  log: (line: string) => void = () => undefined,
): Promise<void> {
  const archives = new Map<string, Promise<Uint8Array>>();
  const failures: string[] = [];
  for (const file of files) {
    const path = join(root, file.path);
    if (existsSync(path) && sha256(new Uint8Array(readFileSync(path))) === file.sha256) {
      log(`${file.path}: present`);
      continue;
    }
    try {
      let bytes: Uint8Array;
      if (file.member === undefined) {
        bytes = await fetcher(file.url);
      } else {
        const cached = archives.get(file.url) ?? fetcher(file.url);
        archives.set(file.url, cached);
        bytes = zipMember(await cached, file.member);
      }
      const actual = sha256(bytes);
      if (actual !== file.sha256) {
        failures.push(`${file.path}: SHA-256 ${actual}, registered ${file.sha256} (${file.url})`);
        continue;
      }
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
      log(`${file.path}: downloaded`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`${file.path}: ${reason} (${file.url})`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`${failures.length} source file(s) failed:\n${failures.join('\n')}`);
  }
}

const ATTEMPTS = 4;
const TIMEOUT_MS = 120_000;

/** A failure worth another attempt: a network error, a timeout, 429 or a 5xx. */
export class Transient extends Error {}

const once = async (url: string): Promise<Uint8Array> => {
  let response: Response;
  try {
    response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new Transient(error instanceof Error ? error.message : String(error));
  }
  if (response.status === 429 || response.status >= 500) {
    throw new Transient(`HTTP ${response.status}`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  try {
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw new Transient(error instanceof Error ? error.message : String(error));
  }
};

/**
 * Wraps `attempt` with retries and backoff for transient failures only. Anything else, and a
 * hash mismatch (checked by the caller), is not retried.
 */
export function withRetry(
  attempt: Fetcher,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Fetcher {
  return async (url) => {
    for (let n = 1; ; n++) {
      try {
        return await attempt(url);
      } catch (error) {
        if (!(error instanceof Transient) || n >= ATTEMPTS) throw error;
        await sleep(1000 * 2 ** (n - 1));
      }
    }
  };
}

export const httpFetcher: Fetcher = withRetry(once);
