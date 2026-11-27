import type { InputLog } from '../contracts/exercise';
import { t } from '../i18n/i18n';
import { EXERCISE_TITLE, LAYOUT_NAME } from './entry-keys';

export { EXERCISE_BRIEF, EXERCISE_TITLE, LAYOUT_NAME } from './entry-keys';

/** What a stored run replays: the exercise, or the free yard it was driven in. */
export function replayContext(log: InputLog): string {
  return log.exerciseId === null
    ? `${t('freeYard')} · ${t(LAYOUT_NAME[log.layoutId])}`
    : t(EXERCISE_TITLE[log.role][log.exerciseId]);
}
