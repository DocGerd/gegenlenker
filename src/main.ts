if (new URLSearchParams(location.search).has('probe')) {
  void import('./render/probe').then((m) => m.startProbe(document.body));
} else {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (app) app.textContent = 'Gegenlenker';
}
