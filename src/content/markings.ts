import type { Marking, MarkingKind } from '../contracts/layout';

export function solidLine(
  kind: MarkingKind,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
): Marking {
  return { kind, from: { x: ax, y: ay }, to: { x: bx, y: by }, width, dashed: false };
}

const ARROW_STROKE = 0.2;
const ARROW_HEAD_RATIO = 0.3;
const ARROW_HEAD_ANGLE = Math.PI / 6;

/** Direction arrow: a shaft from the tail to the tip, with two head strokes. */
export function arrow(tailX: number, tailY: number, heading: number, length: number): Marking[] {
  const tipX = tailX + Math.cos(heading) * length;
  const tipY = tailY + Math.sin(heading) * length;
  const head = length * ARROW_HEAD_RATIO;
  const barb = (side: number): Marking => {
    const a = heading + Math.PI + side * ARROW_HEAD_ANGLE;
    return solidLine(
      'arrow',
      tipX,
      tipY,
      tipX + Math.cos(a) * head,
      tipY + Math.sin(a) * head,
      ARROW_STROKE,
    );
  };
  return [solidLine('arrow', tailX, tailY, tipX, tipY, ARROW_STROKE), barb(1), barb(-1)];
}

// Seven-segment strokes: a top, b top right, c bottom right, d bottom, e bottom left, f top left, g middle.
const DIGIT_SEGMENTS: Readonly<Record<string, string>> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abged',
  '3': 'abgcd',
  '4': 'fgbc',
  '5': 'afgcd',
  '6': 'afgedc',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
};
const DIGIT_WIDTH_RATIO = 0.55;
const DIGIT_GAP_RATIO = 0.35;
const DIGIT_STROKE_RATIO = 0.12;

/** Upright (+y up) seven-segment number centred on (cx, cy); strokes overlap at the corners. */
export function numberMarkings(
  text: string,
  kind: MarkingKind,
  cx: number,
  cy: number,
  height: number,
): Marking[] {
  const w = height * DIGIT_WIDTH_RATIO;
  const stroke = height * DIGIT_STROKE_RATIO;
  const pitch = w + height * DIGIT_GAP_RATIO;
  const x0 = cx - ((text.length - 1) * pitch) / 2;
  const [l, r, b, m, t] = [-w / 2, w / 2, -height / 2, 0, height / 2];
  const out: Marking[] = [];
  Array.from(text).forEach((ch, i) => {
    const x = x0 + i * pitch;
    const h = (y: number): Marking =>
      solidLine(kind, x + l - stroke / 2, cy + y, x + r + stroke / 2, cy + y, stroke);
    const v = (px: number, y0: number, y1: number): Marking =>
      solidLine(kind, x + px, cy + y0 - stroke / 2, x + px, cy + y1 + stroke / 2, stroke);
    const strokes: Readonly<Record<string, Marking>> = {
      a: h(t),
      g: h(m),
      d: h(b),
      b: v(r, m, t),
      c: v(r, b, m),
      f: v(l, m, t),
      e: v(l, b, m),
    };
    for (const s of DIGIT_SEGMENTS[ch] ?? '') {
      const marking = strokes[s];
      if (marking) out.push(marking);
    }
  });
  return out;
}
