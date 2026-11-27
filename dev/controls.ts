import '../src/styles/fonts';
import '../src/styles/tokens.css';
import '../src/styles/base.css';
import { createControls } from '../src/input/controls';

const stage = document.querySelector<HTMLElement>('#stage');
const out = document.querySelector<HTMLElement>('#out');
if (!stage || !out) throw new Error('harness markup missing');

const controls = createControls(stage, { lockToLockTurns: 5, steerRate: 0.6 });

let last = performance.now();
const frame = (now: number): void => {
  controls.tick((now - last) / 1000, { steer: controls.control().steer });
  last = now;
  out.textContent = JSON.stringify(controls.control());
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
