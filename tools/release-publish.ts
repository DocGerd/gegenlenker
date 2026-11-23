import { VERSION_RE, compareVersions } from './changelog';

/** One row of `gh release list --json tagName,isDraft`. */
export interface ListedRelease {
  tagName: string;
  isDraft: boolean;
}

export interface PublishInput {
  /** Version of the head group of released.json; null while nothing is released. */
  head: string | null;
  /** Commit the `v<head>` tag points at, if the tag exists. */
  tagCommit: string | null;
  /** The commit being published. */
  sha: string;
  /** Every release of the repository, drafts included. */
  releases: readonly ListedRelease[];
}

export type PublishPlan =
  | { action: 'skip' | 'done' | 'fail'; message: string }
  /** `latest` is false when a higher version is already published, e.g. on a late re-run. */
  | { action: 'create'; message: string; latest: boolean };

const versionOf = (tagName: string): string | null =>
  tagName.startsWith('v') && VERSION_RE.test(tagName.slice(1)) ? tagName.slice(1) : null;

/** What the release job does for this commit; every branch of it is safe to re-run. */
export const planPublish = ({ head, tagCommit, sha, releases }: PublishInput): PublishPlan => {
  if (head === null) return { action: 'skip', message: 'no released version: nothing to publish' };
  const tag = `v${head}`;
  if (tagCommit !== null && tagCommit !== sha)
    return { action: 'fail', message: `${tag} already tags ${tagCommit}, not ${sha}` };
  const release = releases.find(({ tagName }) => tagName === tag);
  if (release?.isDraft === true)
    return {
      action: 'fail',
      message: `${tag} has a draft release, which this job did not verify: delete it, then re-run`,
    };
  if (release !== undefined)
    return tagCommit === null
      ? { action: 'fail', message: `${tag} has a release but no tag` }
      : { action: 'done', message: `${tag} is already released` };
  const higher = releases.find(({ tagName, isDraft }) => {
    const version = versionOf(tagName);
    return !isDraft && version !== null && compareVersions(version, head) > 0;
  });
  return higher === undefined
    ? { action: 'create', message: `publishing ${tag}`, latest: true }
    : {
        action: 'create',
        message: `publishing ${tag}, not as Latest: ${higher.tagName} is published`,
        latest: false,
      };
};
