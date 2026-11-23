import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const filesUnder = (dir: string, rel = ''): string[] =>
  readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((entry) => {
    const path = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) return filesUnder(dir, path);
    if (entry.isFile()) return [path];
    throw new Error(`${path} is neither a file nor a directory`);
  });

/** `sha256sum -c` lines for every file under `dir`, sorted by path bytes. */
export const prodManifest = (dir: string): string => {
  const paths = filesUnder(dir).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  if (paths.length === 0) throw new Error(`${dir} has no files`);
  return paths
    .map(
      (path) =>
        `${createHash('sha256')
          .update(readFileSync(join(dir, path)))
          .digest('hex')}  ${path}\n`,
    )
    .join('');
};
