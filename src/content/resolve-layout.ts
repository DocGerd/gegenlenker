import type { ExerciseDefinition } from '../contracts/exercise';
import type { Layout, ResolvedLayout } from '../contracts/layout';
import { WAYPOINT_RADIUS } from '../scoring/score';
import { streetFeatures } from './street';

export function resolveLayout(layout: Layout, exercise: ExerciseDefinition | null): ResolvedLayout {
  const street = streetFeatures(layout.street);
  return {
    id: layout.id,
    bounds: layout.bounds,
    yard: layout.yard,
    surfaces: [{ kind: 'yard', rect: layout.yard }, ...street.surfaces],
    obstacles: [...street.obstacles, ...layout.obstacles, ...(exercise?.obstacles ?? [])],
    markings: [...street.markings, ...layout.markings, ...(exercise?.markings ?? [])],
    target: exercise?.target ?? null,
    waypoint: exercise?.waypoint ? { ...exercise.waypoint, radius: WAYPOINT_RADIUS } : null,
  };
}
