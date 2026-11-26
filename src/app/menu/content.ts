import type { ScreenId } from './graph';

export type ContentModule = { readonly render: (body: HTMLElement) => void };

/** Loaded on demand, so the title paints without them. */
export const CONTENT: Readonly<Partial<Record<ScreenId, () => Promise<ContentModule>>>> = {
  controls: () => import('./screens/controls'),
  whatsNew: () => import('../whats-new'),
};
