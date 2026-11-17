import { formatNumber } from '../i18n/i18n';

export type GaugeLevel = 'ok' | 'warn' | 'danger';

function gaugeLevel(angle: number, limit: number): GaugeLevel {
  const ratio = Math.abs(angle) / limit;
  if (ratio < 0.6) return 'ok';
  if (ratio < 0.85) return 'warn';
  return 'danger';
}

export type Gauge = { readonly el: HTMLElement; set(angle: number): void };

const RAD_TO_DEG = 180 / Math.PI;
const SWEEP_DEG = 90;
// Gaps in the arc mark the two level thresholds on either side.
const TICKS = [0.6, 0.85]
  .flatMap((r) => [r, -r])
  .map((r) => `<path class="hud-tick" d="M0 -45V-55" transform="rotate(${r * SWEEP_DEG})" />`)
  .join('');

const MARKUP = `
  <span class="hud-label"></span>
  <svg viewBox="-58 -58 116 64" aria-hidden="true">
    <path class="hud-arc" d="M-50 0A50 50 0 0 1 50 0" />
    ${TICKS}
    <g class="hud-needle"><path d="M0 0V-44" /></g>
    <circle class="hud-pin" r="4" />
  </svg>
  <span class="hud-value mono"></span>`;

/** Semicircle from −limit (right) to +limit (left); angle > 0 is left, like steer. */
export function createGauge(label: string, limit: number): Gauge {
  const el = document.createElement('div');
  el.className = 'hud-gauge';
  el.innerHTML = MARKUP;
  const part = (sel: string): HTMLElement => el.querySelector(sel) as HTMLElement;
  part('.hud-label').textContent = label;
  const needle = el.querySelector<SVGElement>('.hud-needle') as SVGElement;
  const value = part('.hud-value');

  let level: GaugeLevel | null = null;
  let needleTenths = NaN;
  let degrees = NaN;

  return {
    el,
    set(angle) {
      const next = gaugeLevel(angle, limit);
      if (next !== level) {
        level = next;
        el.dataset['level'] = next;
      }
      const ratio = Math.max(-1, Math.min(1, angle / limit));
      const tenths = Math.round(ratio * SWEEP_DEG * 10);
      if (tenths !== needleTenths) {
        needleTenths = tenths;
        needle.style.transform = `rotate(${-tenths / 10}deg)`;
      }
      const deg = Math.round(angle * RAD_TO_DEG);
      if (deg !== degrees) {
        degrees = deg;
        const sign = deg > 0 ? '+' : deg < 0 ? '−' : '';
        value.textContent = `${sign}${formatNumber(Math.abs(deg), 0)}°`;
      }
    },
  };
}
