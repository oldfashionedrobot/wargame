import {
  canSelectUnit,
  coordinatesEqual,
  exploreMovement,
  getUnit,
  getUnitAt,
  getUnitType,
} from '@vod/shared';
import type { Command, Coordinate, GameState, Movement } from '@vod/shared';

// A discriminated union rather than nullable fields: "reachable tiles with no
// selected unit" was representable and meaningless. Phase 8 adds
// `choosingTarget` -- a member, not a conversion.
//
// Everything on a selected member is a snapshot taken at selection time --
// `position` exactly as `reachableTiles` always was. That is what lets the
// renderer push be a projection of the selection alone, with no game state in
// hand and no choice about which state to read.
export type SelectionState =
  | { phase: 'idle' }
  | { phase: 'unitSelected'; unitId: string; position: Coordinate; movement: Movement }
  // A destination is pinned and the menu is open. Nothing has been sent: this
  // is a plan, and Cancel discards it without the server ever hearing about it.
  // `path[0]` is where the unit still stands, so unpinning needs no extra field.
  | { phase: 'destinationChosen'; unitId: string; path: Coordinate[]; movement: Movement };

export type DestinationChosen = Extract<SelectionState, { phase: 'destinationChosen' }>;

export const initialSelectionState: SelectionState = { phase: 'idle' };

// The one constructor of the selected phase, so the snapshot is taken in one
// place: a selectable unit under the click becomes the selection, anything
// else clears it.
function trySelect(state: GameState, coordinate: Coordinate): SelectionState {
  const unit = getUnitAt(state, coordinate);
  if (!unit || !canSelectUnit(state, unit)) return initialSelectionState;
  const { movementRange, movementType } = getUnitType(unit.unitTypeId);
  return {
    phase: 'unitSelected',
    unitId: unit.id,
    position: unit.position,
    // The whole search, not just its tiles: `pathTo` builds the path a move
    // command carries, and the renderer reads it again to draw the route
    // under the pointer.
    movement: exploreMovement(state, unit, movementRange, movementType),
  };
}

/**
 * The new selection a click produces. **Never a command** -- a click picks a
 * destination, and only the menu commits one. Commands are built from a
 * selection by `moveCommandFor`, which is why the two are separate functions:
 * every command's accompanying selection is a constant the caller already
 * knows, so pairing them in one return value carried no information.
 */
export function handleTileClick(
  state: GameState,
  selection: SelectionState,
  coordinate: Coordinate,
): SelectionState {
  // The menu owns the decision once a destination is pinned. Returning the
  // same object rather than an equal one keeps a stray click from re-rendering.
  if (selection.phase === 'destinationChosen') return selection;

  const selectedUnit =
    selection.phase === 'unitSelected' ? getUnit(state, selection.unitId) : undefined;

  // Nothing usefully selected -- idle, or the selected unit has vanished from
  // state under us. Either way the click means "try to select".
  if (selection.phase === 'idle' || !selectedUnit) return trySelect(state, coordinate);

  // The unit's own tile is a destination like any other, which is how acting
  // without moving needs no gesture of its own. A single-element path costs 0,
  // and `validatePath` exempts the mover from its own occupancy check.
  if (coordinatesEqual(coordinate, selectedUnit.position)) {
    return {
      phase: 'destinationChosen',
      unitId: selection.unitId,
      path: [selectedUnit.position],
      movement: selection.movement,
    };
  }

  // `reachable` decides whether this is a destination -- not `pathTo`, which
  // answers for any tile the search settled, friendly-occupied ones included,
  // and those are exactly the tiles nobody may stop on. Only once it *is* a
  // destination does `pathTo` build the route the command carries; the server
  // walks that route rather than deriving one, so it has to be a real one.
  const isInRange = selection.movement.reachable.some((tile) => coordinatesEqual(tile, coordinate));
  const path = isInRange ? selection.movement.pathTo(coordinate) : null;
  if (path) {
    return {
      phase: 'destinationChosen',
      unitId: selection.unitId,
      path,
      movement: selection.movement,
    };
  }

  // Not a destination: another selectable unit switches the selection to it,
  // and a dead click clears it. trySelect answers both.
  return trySelect(state, coordinate);
}

/**
 * Cancel: back to having the unit selected, standing where it always was.
 *
 * Deliberately not `idle` -- the player picked a destination and changed their
 * mind, so the useful next thing is picking another one, not selecting again.
 */
export function unpinDestination(selection: DestinationChosen): SelectionState {
  return {
    phase: 'unitSelected',
    unitId: selection.unitId,
    position: selection.path[0],
    movement: selection.movement,
  };
}

/** Wait: commit the pinned move exactly as it stands. */
export function moveCommandFor(selection: DestinationChosen): Command {
  return { type: 'move', unitId: selection.unitId, path: selection.path };
}
