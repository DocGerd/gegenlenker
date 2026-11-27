import type { SignId } from '../contracts/einweiser';
import type { MessageKey } from './en';

/** Each hand signal's name (`docs/glossary.md`); arms down is `signNone`. */
export const SIGN_NAME: Readonly<Record<SignId, MessageKey>> = {
  achtung: 'signAchtung',
  halt: 'signHalt',
  haltGefahr: 'signHaltGefahr',
  abfahren: 'signAbfahren',
  herkommen: 'signHerkommen',
  entfernen: 'signEntfernen',
  links: 'signLinks',
  rechts: 'signRechts',
  abstand: 'signAbstand',
};
