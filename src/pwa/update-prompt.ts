import { registerSW } from 'virtual:pwa-register';
import { t } from '../i18n/i18n';
import { failOnRedundantInstall, offlineStatus, setOfflineStatus } from './offline-status';
import './update-prompt.css';

const OFFLINE_READY_MS = 4000;
const UPDATE_CHECK_MS = 60 * 60 * 1000;

export function startUpdatePrompt(root: HTMLElement): void {
  const toast = document.createElement('div');
  toast.className = 'update-toast';
  toast.hidden = true;
  toast.setAttribute('role', 'status');
  root.append(toast);

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

  // onOfflineReady fires only on first install; a controlled page was served by a completed precache.
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller !== null) {
    setOfflineStatus('ready');
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
      if (offlineStatus() !== 'ready') setOfflineStatus('failed');
      show(t('offlineSetupFailed'), button(t('dismiss'), hide));
    },
    onOfflineReady() {
      setOfflineStatus('ready');
      show(t('offlineReady'));
      hideTimer = window.setTimeout(hide, OFFLINE_READY_MS);
    },
  });
}
