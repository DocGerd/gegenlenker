import { t } from '../i18n/i18n';

export type BuildInfo = typeof __BUILD__;

/** Release builds name their version; any other build names its commit, never the placeholder. */
export const describeBuild = ({ version, release, commit }: BuildInfo): string =>
  release
    ? t('buildRelease').replace('{version}', version)
    : t('buildDevelopment').replace('{commit}', commit);

export const buildLabel = (): string => describeBuild(__BUILD__);
