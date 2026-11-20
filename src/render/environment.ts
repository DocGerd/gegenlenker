import {
  BufferGeometry,
  Color,
  Group,
  Mesh,
  RingGeometry,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Texture,
} from 'three';
import { MeshLambertNodeMaterial, type MeshStandardNodeMaterial } from 'three/webgpu';
import type { ResolvedLayout } from '../contracts/layout';
import type { RenderFrame, ScenePalette } from '../contracts/render';
import { FOG_DENSITY, GRADE, setGraded } from './grade';
import {
  Chunks,
  groundGeometry,
  outlineGeometry,
  texturedGroundGeometry,
  toleranceGeometry,
} from './ground-geometry';
import { createGroundMaterial } from './ground-material';
import type { GroundPbrTextures } from './ground-pbr';
import { createGroundPbrMaterial } from './ground-pbr-material';
import type { GroundTextures } from './ground-texture';
import type { SkyTextures } from './sky-texture';
import {
  createLightRig,
  perspectiveLight,
  perspectiveSunDirection,
  sunPosition,
} from './light-rig';
import type { QualityFlags } from './quality';
import { AIDS_LAYER, type Environment } from './seams';
import { REALISM_HUES } from './realism-hues';
import { createSkyline } from './skyline';
import { createSceneSky, domeGround } from './scene-sky';
import { tint } from './tint';
import { addMarking, addObstacle } from './yard-tokens';
import { tokenCopy } from './token-copy';
import { isOnYard, RESTYLED_KINDS, yardProps } from './yard-props';

const TARGET_Y = 0.012;
const TARGET_STRIP = 0.15;
const BAND_STRIP = 0.08;
const BAND_CASING = 0.05; // dark edge on each side, so the accent reads on light grounds
const BAND_Y = 0.016;
const BAND_CASING_DROP = 0.005;
const BAND_LIFT = 0.004;
const BAND_RING_SHARE = 0.5;
const BAND_YARD_DIVISOR = 150; // the whole-yard view shows the band this many strokes across the yard
const GATE_STRIP = 0.3;
const GATE_SEGMENTS = 64;

export function proceduralEnvironment(
  layout: ResolvedLayout,
  palette: ScenePalette,
  groundTextures?: GroundTextures,
  skyTexture?: SkyTextures,
  groundPbr?: GroundPbrTextures,
): Environment {
  const group = new Group();
  const geometries: BufferGeometry[] = [];
  const solid = new MeshLambertMaterial({ vertexColors: true });
  const flat = new MeshBasicMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const color = new Color();
  const roof = new Color();

  const ground = groundGeometry(layout, palette);
  geometries.push(ground);
  const tokenGround = new Mesh(ground, solid);
  group.add(tokenGround);

  // High: perspective cameras draw this textured copy of the ground instead, top-down keeps the tokens.
  // The PBR ground, once loaded, takes over the copy's material; the detail material is its fallback.
  let texturedGroundMaterial: MeshLambertNodeMaterial | null = null;
  let texturedGround: Mesh | null = null;
  let detailMap: Texture | null = null;
  let pbrMaps: Parameters<typeof createGroundPbrMaterial>[0] | null = null;
  let pbrMaterial: MeshStandardNodeMaterial | null = null;
  let pbrWanted = false;
  let pbrReported = false;
  const syncGroundPbr = (): void => {
    if (texturedGround === null || texturedGroundMaterial === null) return;
    if (pbrMaterial === null && pbrMaps !== null && detailMap !== null) {
      try {
        pbrMaterial = createGroundPbrMaterial(pbrMaps, detailMap, {
          x: layout.bounds.minX,
          y: layout.bounds.minY,
        });
        setGraded(pbrMaterial, graded);
      } catch (error) {
        pbrMaps = null;
        console.warn('PBR ground could not be applied; keeping the detail ground', error);
      }
    }
    const on = pbrWanted && pbrMaterial !== null;
    texturedGround.material = on && pbrMaterial !== null ? pbrMaterial : texturedGroundMaterial;
    if (on !== pbrReported) {
      pbrReported = on;
      groundPbr?.reportApplied(on);
    }
  };
  const groundSwap = tokenCopy([tokenGround], (on) => groundTextures?.reportApplied(on));
  const cancelGroundTexture = groundTextures?.onLoaded(
    ({ detail: texture }) => {
      let geometry: BufferGeometry | null = null;
      let material: MeshLambertNodeMaterial | null = null;
      try {
        geometry = texturedGroundGeometry(layout, palette);
        material = createGroundMaterial(texture);
        setGraded(material, graded);
        const mesh = new Mesh(geometry, material);
        mesh.receiveShadow = true;
        group.add(mesh);
        geometries.push(geometry);
        texturedGroundMaterial = material;
        texturedGround = mesh;
        detailMap = texture;
        groundSwap.setCopies([mesh]);
        syncGroundPbr();
      } catch (error) {
        geometry?.dispose();
        material?.dispose();
        console.warn('Ground texture could not be applied; keeping the token ground', error);
      }
    },
    () => {
      groundSwap.disable();
    },
  );
  const cancelGroundPbr = groundPbr?.onLoaded(
    (maps) => {
      pbrMaps = maps;
      syncGroundPbr();
    },
    () => {
      pbrMaps = null;
      pbrMaterial?.dispose();
      pbrMaterial = null;
      syncGroundPbr();
    },
  );

  // Restyled kinds keep a plain token copy for the top-down view only; the cockpit and mirrors draw
  // the detail copy from yard-props on PERSPECTIVE_LAYER.
  const obstacles = new Chunks(layout.bounds);
  const topDownOnly = new Chunks(layout.bounds);
  const detail = new Chunks(layout.bounds);
  const { yard } = layout;
  for (const o of layout.obstacles) {
    const { cx, cy } = o.obb;
    const chunks = RESTYLED_KINDS.has(o.kind) ? topDownOnly : obstacles;
    addObstacle(o, palette, chunks, color, roof, isOnYard(yard, cx, cy));
  }
  for (const mesh of obstacles.meshes(solid, geometries)) group.add(mesh);
  const tokens = topDownOnly.meshes(solid, geometries);
  for (const mesh of tokens) group.add(mesh);
  for (const piece of yardProps(layout)) detail.add(piece.x, piece.y, piece.geometry);
  // graded props wear their own copy, so the grade never reaches the layer-0 tokens
  const propMaterial = new MeshLambertNodeMaterial({ vertexColors: true });
  setGraded(propMaterial, true);
  const props = detail.meshes(solid, geometries);
  for (const mesh of props) group.add(mesh);
  // Without the props the obstacles must still show in perspective, so the tokens go to every camera.
  const propSwap = tokenCopy(tokens);
  propSwap.set(true); // detail on until the first setQuality
  propSwap.setCopies(props);

  const markings = new Chunks(layout.bounds);
  color.set(palette.marking);
  for (const m of layout.markings) addMarking(m, markings, color);
  const markingTokens = markings.meshes(flat, geometries);
  for (const mesh of markingTokens) group.add(mesh);
  // Perspective cameras draw lit copies of every flat token; the tokens keep the top-down view, unlit.
  const litFlat = new MeshLambertNodeMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const flatTokens: Mesh[] = [];
  const flatCopies: Mesh[] = [];
  const litCopy = (token: Mesh, material: MeshLambertNodeMaterial): void => {
    const copy = new Mesh(token.geometry, material);
    copy.receiveShadow = true;
    group.add(copy);
    flatTokens.push(token);
    flatCopies.push(copy);
  };
  for (const token of markingTokens) litCopy(token, litFlat);

  let yardBand: Group | null = null;
  const { target } = layout;
  if (target !== null) {
    color.set(palette.accent);
    const outline = tint(
      outlineGeometry(target.length, target.width, TARGET_STRIP)
        .rotateY(target.pose.heading)
        .translate(target.pose.x, TARGET_Y, -target.pose.y),
      color,
    );
    geometries.push(outline);
    const outlineToken = new Mesh(outline, flat);
    group.add(outlineToken);
    litCopy(outlineToken, litFlat);

    const { tolerances } = layout;
    if (tolerances !== null) {
      const place = (g: BufferGeometry, y: number): BufferGeometry =>
        g.rotateY(target.pose.heading).translate(target.pose.x, y, -target.pose.y);
      const addBand = (strip: number, lift: number): Mesh[] => {
        const casing = place(
          toleranceGeometry(
            tolerances,
            target.length,
            strip + 2 * BAND_CASING * (strip / BAND_STRIP),
          ),
          BAND_Y + lift - BAND_CASING_DROP,
        );
        color.set(palette.wheel);
        tint(casing, color);
        color.set(palette.accent);
        const band = tint(
          place(toleranceGeometry(tolerances, target.length, strip), BAND_Y + lift),
          color,
        );
        geometries.push(casing, band);
        return [new Mesh(casing, flat), new Mesh(band, flat)];
      };
      const bandTokens = addBand(BAND_STRIP, 0);
      group.add(...bandTokens);
      for (const token of bandTokens) litCopy(token, litFlat);

      // World-metre strokes shrink to under a pixel in the whole-yard view, so it gets a wider copy.
      const { yard } = layout;
      const yardStrip = Math.min(
        Math.max(yard.maxX - yard.minX, yard.maxY - yard.minY) / BAND_YARD_DIVISOR,
        tolerances.position * BAND_RING_SHARE, // a stroke wider than the tolerance would blur the ring
      );
      if (yardStrip > BAND_STRIP) {
        yardBand = new Group();
        for (const m of addBand(yardStrip, BAND_LIFT)) yardBand.add(m);
        yardBand.traverse((o) => o.layers.set(AIDS_LAYER));
        group.add(yardBand);
      }
    }
  }

  const { waypoint } = layout;
  let gate: {
    materials: readonly [MeshBasicMaterial, MeshLambertNodeMaterial];
    pending: Color;
    passed: Color;
  } | null = null;
  if (waypoint !== null) {
    const half = GATE_STRIP / 2;
    const ring = new RingGeometry(waypoint.radius - half, waypoint.radius + half, GATE_SEGMENTS)
      .rotateX(-Math.PI / 2)
      .translate(waypoint.x, TARGET_Y, -waypoint.y);
    const material = new MeshBasicMaterial({
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const litMaterial = new MeshLambertNodeMaterial({
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    geometries.push(ring);
    const gateToken = new Mesh(ring, material);
    group.add(gateToken);
    litCopy(gateToken, litMaterial);
    gate = {
      materials: [material, litMaterial],
      pending: new Color(palette.accent),
      passed: new Color(palette.marking),
    };
    for (const m of gate.materials) m.color.copy(gate.pending);
  }
  const flatSwap = tokenCopy(flatTokens);
  flatSwap.setCopies(flatCopies);

  const rig = createLightRig(palette);
  group.add(rig.object);
  const light = perspectiveLight(palette);
  const sunDirection = perspectiveSunDirection();
  const haze = new Color(REALISM_HUES.skyHaze);
  const sky = createSceneSky(palette);
  const legacyGround = domeGround(palette, false);
  const splitGround = domeGround(palette, true);
  const skyline = createSkyline(layout.bounds, haze);
  group.add(sky.mesh, skyline.mesh);

  let graded = false;
  let hdriOn = false;
  let hdriMap: Texture | null = null;
  let hdriReported = false;
  let disposed = false;
  const syncSky = (): void => {
    const on = hdriOn && hdriMap !== null;
    sky.setHdri(on ? hdriMap : null);
    // the haze uniforms are shared: a disposed environment must not overwrite the live one's
    if (!disposed) {
      GRADE.hazeToward.value.copy(on ? light.hazeToward : haze);
      GRADE.hazeAway.value.copy(on ? light.hazeAway : haze);
    }
    if (on !== hdriReported) {
      hdriReported = on;
      skyTexture?.reportApplied(on);
    }
  };
  const cancelSkyTexture = skyTexture?.onLoaded(
    ({ sky: map }) => {
      hdriMap = map;
      syncSky();
    },
    () => {
      hdriMap = null;
      syncSky();
    },
  );

  return {
    object: group,
    update(frame: RenderFrame): void {
      if (yardBand !== null) yardBand.visible = frame.topDown === 'yard';
      if (gate !== null) {
        const next = frame.waypointVisited === true ? gate.passed : gate.pending;
        for (const m of gate.materials) m.color.copy(next);
      }
    },
    setQuality(flags: QualityFlags): void {
      graded = flags.perspectiveLighting;
      rig.setSplit(graded);
      sky.setSun(graded ? sunDirection : sunPosition());
      sky.setGround(graded ? splitGround : legacyGround);
      GRADE.sunDirection.value.copy(sunDirection);
      GRADE.fogDensity.value = flags.aerialPerspective ? FOG_DENSITY : 0;
      hdriOn = flags.hdriSky;
      syncSky();
      for (const mesh of props) mesh.material = graded ? propMaterial : solid;
      if (texturedGroundMaterial !== null) setGraded(texturedGroundMaterial, graded);
      if (pbrMaterial !== null) setGraded(pbrMaterial, graded);
      pbrWanted = flags.groundPbr;
      syncGroundPbr();
      setGraded(litFlat, graded);
      if (gate !== null) setGraded(gate.materials[1], graded);
      skyline.setGraded(graded);
      skyline.mesh.visible = flags.skyline;
      groundSwap.set(flags.groundTexture);
      propSwap.set(flags.yardDetail);
      flatSwap.set(flags.litMarkings);
    },
    dispose: () => {
      cancelGroundTexture?.();
      cancelGroundPbr?.();
      cancelSkyTexture?.();
      disposed = true;
      hdriMap = null;
      hdriOn = false;
      syncSky();
      groundSwap.disable();
      texturedGroundMaterial?.dispose();
      pbrMaterial?.dispose();
      geometries.forEach((g) => g.dispose());
      gate?.materials.forEach((m) => m.dispose());
      solid.dispose();
      propMaterial.dispose();
      flat.dispose();
      litFlat.dispose();
      sky.dispose();
      skyline.dispose();
    },
  };
}
