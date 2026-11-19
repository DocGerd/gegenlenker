import { type Page } from '@playwright/test';
import { expect } from './fixtures';
import { ASSET_REGISTRY, ATTACHMENTS, type Attachment } from '../src/render/asset-registry';

const KTX2_FLAGS = new Set(
  Object.values(ASSET_REGISTRY)
    .filter(({ kind }) => kind === 'ktx2')
    .map(({ flag }) => flag),
);

/** The markers of the attachments that draw a KTX2 texture. */
const TEXTURE_MARKERS = Object.values<Attachment>(ATTACHMENTS)
  .filter((a) => a.flags.some((f) => KTX2_FLAGS.has(f)))
  .map((a) => a.marker);

/** Records a given-up texture: sessionStorage outlives reloads, the attribute does not. */
export async function watchFailedAttachments(page: Page): Promise<void> {
  await page.addInitScript((markers) => {
    new MutationObserver((records) => {
      for (const r of records) {
        // oldValue catches a value replaced before this callback runs
        const now =
          r.target instanceof Element ? r.target.getAttribute(r.attributeName ?? '') : null;
        if (now === 'failed' || r.oldValue === 'failed')
          sessionStorage.setItem('attachment-failed', r.attributeName ?? '');
      }
    }).observe(document, {
      attributes: true,
      attributeOldValue: true,
      subtree: true,
      attributeFilter: markers,
    });
  }, TEXTURE_MARKERS);
}

export async function expectNoFailedAttachment(page: Page): Promise<void> {
  expect(await page.evaluate(() => sessionStorage.getItem('attachment-failed'))).toBeNull();
}
