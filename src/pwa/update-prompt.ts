import { registerSW } from 'virtual:pwa-register';
import { t } from '../i18n/i18n';
import type { GraphicsPreset } from '../contracts/render';
import { presetAssetUrls } from '../render/asset-urls';
import { failOnRedundantInstall, precached, setOfflineStatus } from './offline-status';
import { browserHost, createPresetCache } from './preset-cache';
import './update-prompt.css';

const OFFLINE_READY_MS = 4000;
const UPDATE_CHECK_MS = 60 * 60 * 1000;

/** `preset` is the saved graphics preset; call the returned function after it changes. */
export function startUpdatePrompt(root: HTMLElement, preset: () => GraphicsPreset): () => void {
  const toast = document.createElement('div');
  toast.className = 'update-toast';
  toast.hidden = true;
  toast.setAttribute('role', 'status');
  root.append(toast);

  // Screens keep their last controls clear of the toast, whatever its height or width.
  const reserve = () => {
    const { top, height } = toast.getBoundingClientRect();
    root.style.setProperty('--toast-reserve', height > 0 ? `${window.innerHeight - top}px` : '0px');
  };
  new ResizeObserver(reserve).observe(toast);
  window.addEventListener('resize', reserve);

  let hideTimer: number | undefined;
  const hide = () => {
    window.clearTimeout(hideTimer);
    toast.hidden = true;
  };
  const show = (message: string, ...actions: HTMLButtonElement[]) => {
    window.clearTimeout(hideTimer);
    const text = document.createElement('span');
    text.textContent = message;
    toast.replaceChildren(text, ...actions);
    toast.hidden = false;
  };
  const button = (label: string, onClick: () => void) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.addEventListener('click', onClick);
    return el;
  };

  // Offline-ready needs the precache and the saved preset's own assets, which are fetched while online.
  let shellCached = false;
  let announce = false;
  const presets = createPresetCache(
    browserHost(() => presetAssetUrls(preset())),
    (ready) => {
      setOfflineStatus(ready ? 'ready' : 'incomplete');
      if (ready && announce) {
        announce = false;
        show(t('offlineReady'));
        hideTimer = window.setTimeout(hide, OFFLINE_READY_MS);
      }
    },
  );
  const refreshPreset = () => {
    if (shellCached) void presets.refresh();
  };
  const markShellCached = () => {
    shellCached = true;
    refreshPreset();
  };

  // onOfflineReady fires only on first install; a controlled page was served by a completed precache.
  if ('serviceWorker' in navigator) {
    if (navigator.serviceWorker.controller !== null) markShellCached();
    navigator.serviceWorker.addEventListener('controllerchange', refreshPreset);
    window.addEventListener('online', refreshPreset);
  }

  const updateSW = registerSW({
    onNeedRefresh() {
      show(
        t('updateAvailable'),
        button(t('reload'), () => void updateSW()),
        button(t('later'), hide),
      );
    },
    onRegisteredSW(_url, registration) {
      if (registration) {
        failOnRedundantInstall(registration, () => navigator.serviceWorker.controller !== null);
        window.setInterval(
          () => void registration.update().catch(() => undefined),
          UPDATE_CHECK_MS,
        );
      }
    },
    onRegisterError(error) {
      console.error('SW registration failed', error);
      if (!shellCached && !precached()) setOfflineStatus('failed');
      show(t('offlineSetupFailed'), button(t('dismiss'), hide));
    },
    onOfflineReady() {
      announce = true;
      markShellCached();
    },
  });
  return () => {
    // Not ready for the new preset until its assets are found.
    if (shellCached) setOfflineStatus('unknown');
    refreshPreset();
  };
}
