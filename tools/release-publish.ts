export type ReleaseStatus = 'none' | 'draft' | 'published';

export interface PublishInput {
  /** Version of the head group of released.json; null while nothing is released. */
  head: string | null;
  /** Commit the `v<head>` tag points at, if the tag exists. */
  tagCommit: string | null;
  /** The commit being published. */
  sha: string;
  release: ReleaseStatus;
}

export interface PublishPlan {
  action: 'skip' | 'create' | 'done' | 'fail';
  message: string;
}

/** What the release job does for this commit; every branch of it is safe to re-run. */
export const planPublish = ({ head, tagCommit, sha, release }: PublishInput): PublishPlan => {
  if (head === null) return { action: 'skip', message: 'no released version: nothing to publish' };
  const tag = `v${head}`;
  if (tagCommit !== null && tagCommit !== sha)
    return { action: 'fail', message: `${tag} already tags ${tagCommit}, not ${sha}` };
  if (release === 'draft')
    return { action: 'fail', message: `${tag} has a draft release: publish or delete it` };
  if (release === 'published')
    return tagCommit === null
      ? { action: 'fail', message: `${tag} has a release but no tag` }
      : { action: 'done', message: `${tag} is already released` };
  return { action: 'create', message: `publishing ${tag}` };
};
