// Usage: node scripts/fetch-asset-sources.mjs   (pnpm assets:fetch)
// Downloads every registered third-party source to its git-ignored path and checks its SHA-256.
import console from 'node:console';
import { join } from 'node:path';
import { runnerImport } from 'vite';

const root = join(import.meta.dirname, '..');
const load = async (file) =>
  (await runnerImport(file, { root, configFile: false, logLevel: 'error' })).module;
const { ASSET_SOURCES } = await load('/tools/assets/sources.ts');
const { downloadSources, httpFetcher } = await load('/tools/assets/download.ts');

const files = Object.values(ASSET_SOURCES).flatMap((source) => source.files);
await downloadSources(files, root, httpFetcher, console.log);
