import type { ExerciseDefinition } from '../contracts/exercise';
import { colliderId, type Layout, type Obstacle, type ResolvedLayout } from '../contracts/layout';
import { WAYPOINT_RADIUS } from '../scoring/score';
import { streetFeatures } from './street';

const propObstacles = ({ props }: Layout): Obstacle[] =>
  props.flatMap((prop) => prop.colliders.map((c, i) => ({ id: colliderId(prop.id, i), ...c })));

export function resolveLayout(layout: Layout, exercise: ExerciseDefinition | null): ResolvedLayout {
  const street = streetFeatures(layout.street);
  return {
    id: layout.id,
    bounds: layout.bounds,
    yard: layout.yard,
    surfaces: [{ kind: 'yard', rect: layout.yard }, ...street.surfaces],
    obstacles: [
      ...street.obstacles,
      ...layout.obstacles,
      ...propObstacles(layout),
      ...(exercise?.obstacles ?? []),
    ],
    props: layout.props,
    markings: [...street.markings, ...layout.markings, ...(exercise?.markings ?? [])],
    target: exercise?.target ?? null,
    tolerances: exercise?.tolerances ?? null,
    waypoint: exercise?.waypoint ? { ...exercise.waypoint, radius: WAYPOINT_RADIUS } : null,
  };
}
