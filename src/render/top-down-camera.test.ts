import { OrthographicCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TOP_DOWN_VIEW, type TopDownView } from '../contracts/render';
import { panBy, zoomAt, type ViewContext } from '../input/top-down-view';
import { placeTopDownCamera } from './top-down-camera';

const BASE_HALF = 20;
const CENTRE = { x: 12, y: -7 };
const ctx: ViewContext = { mode: 'yard', width: 600, height: 400 };

function camera(): OrthographicCamera {
  const cam = new OrthographicCamera(-1, 1, 1, -1, 1, 400);
  cam.rotation.x = -Math.PI / 2;
  cam.position.y = 200;
  return cam;
}

function place(cam: OrthographicCamera, view: TopDownView): void {
  placeTopDownCamera(cam, CENTRE, BASE_HALF, ctx.width / ctx.height, view);
  cam.updateMatrixWorld();
}

function worldAt(cam: OrthographicCamera, px: number, py: number): Vector3 {
  return new Vector3((px / ctx.width) * 2 - 1, 1 - (py / ctx.height) * 2, 0).unproject(cam);
}

function pixelOf(cam: OrthographicCamera, world: Vector3): [number, number] {
  const ndc = world.clone().project(cam);
  return [((ndc.x + 1) / 2) * ctx.width, ((1 - ndc.y) / 2) * ctx.height];
}

describe('placeTopDownCamera', () => {
  it('the default view frames the base centre', () => {
    const cam = camera();
    place(cam, DEFAULT_TOP_DOWN_VIEW);
    const centre = worldAt(cam, 300, 200);
    expect(centre.x).toBeCloseTo(CENTRE.x, 9);
    expect(centre.z).toBeCloseTo(-CENTRE.y, 9);
  });

  it('a pan of (dx, dy) pixels moves the content under the finger by (dx, dy)', () => {
    const cam = camera();
    const start = zoomAt(DEFAULT_TOP_DOWN_VIEW, 3, { x: 300, y: 200 }, ctx);
    place(cam, start);
    const grabbed = worldAt(cam, 250, 140);
    const [dx, dy] = [40, -25];
    place(cam, panBy(start, dx, dy, ctx));
    const [px, py] = pixelOf(cam, grabbed);
    expect(px).toBeCloseTo(250 + dx, 6);
    expect(py).toBeCloseTo(140 + dy, 6);
  });

  it('zooming about a cursor keeps the world point under it', () => {
    const cam = camera();
    place(cam, DEFAULT_TOP_DOWN_VIEW);
    const cursor = { x: 480, y: 90 };
    const grabbed = worldAt(cam, cursor.x, cursor.y);
    place(cam, zoomAt(DEFAULT_TOP_DOWN_VIEW, 4, cursor, ctx));
    const [px, py] = pixelOf(cam, grabbed);
    expect(px).toBeCloseTo(cursor.x, 6);
    expect(py).toBeCloseTo(cursor.y, 6);
  });
});
