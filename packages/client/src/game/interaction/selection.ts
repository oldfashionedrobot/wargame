import {
  canSelectUnit,
  coordinatesEqual,
  directionBetween,
  exploreMovement,
  getUnit,
  getUnitAt,
  getUnitType,
} from '@vod/shared';
import type { Command, Coordinate, Facing, GameState, Movement } from '@vod/shared';

// A discriminated union rather than nullable fields: "reachable tiles with no
// selected unit" was representable and meaningless. Phase 9 adds an attack
// target to `destinationChosen` -- a click it already reads, not a new member.
//
// Everything on a selected member is a snapshot taken at selection time --
// `position` exactly as `reachableTiles` always was. That is what lets the
// renderer push be a projection of the selection alone, with no game state in
// hand and no choice about which state to read.
export type SelectionState =
  | { phase: 'idle' }
  | { phase: 'unitSelected'; unitId: string; position: Coordinate; movement: Movement }
  // A route is drawn and nothing has moved. The unit still stands on `path[0]`,
  // the range is still lit, and a click on any tile in it re-pins -- so this is
  // a plan in the fullest sense, discarded by a click on the dark.
  //
  // ⚠️ The *second* click on this destination is what commits it to the walk.
  // That exists so the route is state rather than a hover reaction: the
  // renderer used to draw it from `POINTERMOVE` and React never heard, which
  // meant a touchscreen never saw a route at all.
  | { phase: 'routePinned'; unitId: string; path: Coordinate[]; movement: Movement }
  // The unit has walked and the tiles around it are the menu. Still nothing
  // sent: Cancel discards it without the server ever hearing about it.
  //
  // ⚠️ This is *also* the facing choice, which used to be a phase of its own.
  // A click on the destination keeps the direction travelled, a click on one of
  // the four tiles around it overrides that, and phase 9 adds an enemy in range
  // as a third reading of the same gesture. Facing stops being demanded, which
  // is what the design always asked for.
  | { phase: 'destinationChosen'; unitId: string; path: Coordinate[]; movement: Movement };

export type RoutePinned = Extract<SelectionState, { phase: 'routePinned' }>;
export type DestinationChosen = Extract<SelectionState, { phase: 'destinationChosen' }>;

/**
 * Both phases that carry a path. They hold identical data and differ only in
 * whether the unit has walked it yet, so everything reading a path takes this.
 */
export type Pinned = RoutePinned | DestinationChosen;

/** Where a pinned unit is standing, really or in preview. */
function destinationOf(selection: Pinned): Coordinate {
  return selection.path[selection.path.length - 1];
}

/** The tile a second click has to land on to commit the route. */
export function pinnedDestination(selection: Pinned): Coordinate {
  return destinationOf(selection);
}

/** The route is accepted: the unit walks it, and the menu opens on arrival. */
export function confirmRoute(selection: RoutePinned): DestinationChosen {
  return { ...selection, phase: 'destinationChosen' };
}

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
    // command carries, and the path a pinned route draws. ⚠️ The renderer no
    // longer holds this -- it is given tiles to light, not a search to query.
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
  // Once the unit has arrived a click means a direction or a target rather than
  // a tile, and the caller answers it with `holdFacing` and `facingChoiceAt`
  // before ever reaching here. Returning the same object rather than an equal
  // one keeps a stray click from re-rendering.
  //
  // ⚠️ `routePinned` is deliberately *not* excluded: a pinned route is still
  // being chosen, so its clicks are tile clicks and belong here. Only the
  // commit -- a second click on the destination -- is read by the caller first.
  if (selection.phase === 'destinationChosen') return selection;

  // ⚠️ Pinning and re-pinning are the same operation, which is why this reads
  // one unit and one search rather than branching on the phase: `routePinned`
  // carries exactly what `unitSelected` does, and nothing below wants anything
  // else. Moving a pin runs the code that set it.
  if (selection.phase === 'idle') return trySelect(state, coordinate);

  const selectedUnit = getUnit(state, selection.unitId);

  // The selected unit has vanished from state under us; the click means "try
  // to select".
  if (!selectedUnit) return trySelect(state, coordinate);

  // The unit's own tile is a destination like any other, which is how acting
  // without moving needs no gesture of its own. A single-element path costs 0,
  // and `validatePath` exempts the mover from its own occupancy check.
  if (coordinatesEqual(coordinate, selectedUnit.position)) {
    return {
      phase: 'routePinned',
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
      phase: 'routePinned',
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
 * Where the unit is standing while it chooses -- the renderer lights the four
 * tiles around this, clipping to the board itself, since the grid's bounds are
 * its business. A unit on the top row simply has three choices, and facing off
 * the board would be a strictly worse one anyway.
 */
export function facingChoiceOrigin(selection: DestinationChosen): Coordinate {
  return destinationOf(selection);
}

/**
 * Which way this click means, or null if it was not one of the four.
 *
 * ⚠️ Answers `null` for the destination *itself*, since `directionBetween`
 * wants a step of exactly one tile. That is what lets the caller tell "keep the
 * direction travelled" from "face this way" without ordering the two by hand.
 */
export function facingChoiceAt(
  selection: DestinationChosen,
  coordinate: Coordinate,
): Facing | null {
  return directionBetween(destinationOf(selection), coordinate);
}

/**
 * The facing a click on the destination itself means: the way the unit
 * travelled, which it is already standing in after the preview walk.
 *
 * ⚠️ Takes state, unlike the rest of this module, for one case: a path of one
 * tile is acting *without moving*, and there is no last step to read a
 * direction from. The unit keeps the facing it already had.
 *
 * `null` like `facingChoiceAt`, and for the same reason -- the selected unit
 * can vanish from state under a stale selection, and "no answer" is a reading
 * the caller already refuses to commit.
 */
export function holdFacing(state: GameState, selection: DestinationChosen): Facing | null {
  const previous = selection.path.at(-2);
  const travelled = previous ? directionBetween(previous, destinationOf(selection)) : null;
  return travelled ?? getUnit(state, selection.unitId)?.facing ?? null;
}

/**
 * Cancel: back to having the unit selected, standing where it always was.
 *
 * Deliberately not `idle` -- the player picked a destination and changed their
 * mind, so the useful next thing is picking another one, not selecting again.
 */
export function unpinDestination(selection: Pinned): SelectionState {
  return {
    phase: 'unitSelected',
    unitId: selection.unitId,
    position: selection.path[0],
    movement: selection.movement,
  };
}

/** Commit the pinned move, looking the way the player chose. */
export function moveCommandFor(selection: DestinationChosen, facing: Facing): Command {
  return { type: 'move', unitId: selection.unitId, path: selection.path, facing };
}
