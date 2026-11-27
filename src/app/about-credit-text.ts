import type { MessageKey } from '../i18n/en';
import type { AssetCredit, AssetKind, CreditRole } from './about-credits-types';

type Label = (key: MessageKey) => string;

const KIND_KEY: Readonly<Record<AssetKind, MessageKey>> = {
  kitTile: 'creditKindKitTile',
  kitLeaves: 'creditKindKitLeaves',
  sky: 'creditKindSky',
  yardConcrete: 'creditKindYardConcrete',
  streetAsphalt: 'creditKindStreetAsphalt',
  pavers: 'creditKindPavers',
};

const ROLE_KEY: Readonly<Record<CreditRole, MessageKey>> = {
  processing: 'creditRoleProcessing',
  photography: 'creditRolePhotography',
  original: 'creditRoleOriginal',
  skyEdits: 'creditRoleSkyEdits',
};

export function assetKindLabel(kind: AssetKind, label: Label): string {
  return label(KIND_KEY[kind]);
}

/** The credited people with their roles, then the host; names stay as the source spells them. */
export function assetAuthors(
  { people, host }: Pick<AssetCredit, 'people' | 'host'>,
  label: Label,
): string {
  const names = people
    .map(({ name, role }) => (role === undefined ? name : `${name} (${label(ROLE_KEY[role])})`))
    .join(` ${label('creditAnd')} `);
  return names === '' ? host : `${names}, ${host}`;
}
