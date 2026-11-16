import './styles/tokens.css';
import './styles/base.css';
import './styles/fonts';
import { startApp } from './app/app';

if (new URLSearchParams(location.search).has('probe')) {
  import('./render/probe')
    .then((m) => m.startProbe(document.body))
    .catch((error: unknown) => {
      const message = document.createElement('pre');
      message.className = 'mono';
      message.textContent = `Probe failed: ${error instanceof Error ? error.message : String(error)}`;
      document.body.append(message);
    });
} else {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (app) startApp(app);
}
