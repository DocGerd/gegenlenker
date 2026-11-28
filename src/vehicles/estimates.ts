import type { Param } from '../contracts/vehicle';
import { trailers, trucks } from './registry';

const UNITS: Readonly<Record<string, string>> = {
  couplingLimit: '°',
  turntableLimit: '°',
  catchAngle: '°',
  lockToLockTurns: 'turns',
  maxRate: 'turns/s',
  rearAxleCount: '',
};

const isParam = (node: object): node is Param =>
  'value' in node && 'status' in node && 'source' in node;

function* estimates(node: object, path: string[]): Generator<[string[], Param]> {
  if (isParam(node)) {
    if (node.status === 'estimate') yield [path, node];
    return;
  }
  for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
    if (typeof child === 'object' && child !== null) yield* estimates(child, [...path, key]);
  }
}

const cell = (text: string): string => text.replaceAll('|', '\\|');

export function estimatesTable(): string {
  const rows = ['| Vehicle | Parameter | Value | Basis |', '| --- | --- | --- | --- |'];
  for (const spec of [...trucks, ...trailers]) {
    for (const [path, param] of estimates(spec, [])) {
      const unit = UNITS[path[path.length - 1] ?? ''] ?? 'mm';
      const value = unit === '' ? `${param.value}` : `${param.value} ${unit}`;
      rows.push(`| ${cell(spec.name)} | ${path.join('.')} | ${value} | ${cell(param.source)} |`);
    }
  }
  return rows.join('\n');
}
