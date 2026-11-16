import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const INK = '#01AFA1';
const GROUND = '#0D0E10';
const PATHS =
  '<path d="M50 17.09 L69.87 51.5 L30.13 51.5 Z"/>' +
  '<path d="M26.96 57 L73.04 57 L88 82.91 L12 82.91 Z"/>';

const icons = [
  { name: 'pwa-192x192.png', size: 192, mark: 0.62, radius: 0.22 },
  { name: 'pwa-512x512.png', size: 512, mark: 0.62, radius: 0.22 },
  { name: 'pwa-maskable-512x512.png', size: 512, mark: 0.5, radius: 0 },
];

const svg = ({ size, mark, radius }) => {
  const inner = size * mark;
  const offset = (size - inner) / 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${size * radius}" fill="${GROUND}"/>` +
    `<svg x="${offset}" y="${offset}" width="${inner}" height="${inner}" viewBox="0 0 100 100" fill="${INK}">${PATHS}</svg>` +
    '</svg>'
  );
};

const browser = await chromium.launch();
try {
  for (const icon of icons) {
    const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size } });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg(icon)}`,
    );
    const png = await page.screenshot({ omitBackground: true });
    writeFileSync(fileURLToPath(import.meta.resolve(`../public/${icon.name}`)), png);
    await page.close();
  }
} finally {
  await browser.close();
}
