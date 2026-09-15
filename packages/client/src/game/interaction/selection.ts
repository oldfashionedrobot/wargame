import {
  canSelectUnit,
  computeDamage,
  facingToward,
  LUCK_MAX,
  refuseAttack,
  tilesInRange,
  wouldCounter,
  coordinatesEqual,
  directionBetween,
  exploreMovement,
  getUnit,
  getUnitAt,
  getUnitType,
  isWithinGrid,
} from '@vod/shared';
import type { Command, Coordinate, Facing, GameState, Movement, Unit } from '@vod/shared';

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
  | {
      phase: 'destinationChosen';
      unitId: string;
      path: Coordinate[];
      movement: Movement;
      /** What to paint red -- see `attackTilesFor`. Snapshotted, like `movement`. */
      attackTiles: Coordinate[];
      /** What to paint amber -- see `facingTilesFor`. Snapshotted for the same reason. */
      facingTiles: Coordinate[];
    }
  // A target is picked and the panel is up. ⚠️ *Picking* a target is a click,
  // not a state -- but the panel being **open** is a mode: while it is up a tile
  // click means cancel and the buttons are what commit. Still nothing sent.
  | {
      phase: 'targetChosen';
      unitId: string;
      path: Coordinate[];
      movement: Movement;
      attackTiles: Coordinate[];
      facingTiles: Coordinate[];
      target: Unit;
    };

export type RoutePinned = Extract<SelectionState, { phase: 'routePinned' }>;
export type DestinationChosen = Extract<SelectionState, { phase: 'destinationChosen' }>;
export type TargetChosen = Extract<SelectionState, { phase: 'targetChosen' }>;

/**
 * Every phase that carries a path -- an uncommitted plan, in other words,
 * something a board change has to discard.
 *
 * ⚠️ **The type asks the *shape*, not a list.** `Pinned` used to be a hand-written
 * `|` of three phase names sitting beside `isPlan`'s `||` of the same three --
 * two independent statements of one rule, which is what `isPlan`'s own comment
 * already claimed it had fixed and had not. Carrying a path is the actual
 * property, so `Extract` reads it off the union and a new phase with a path
 * joins automatically.
 *
 * ⚠️ The array exists only because a *type* cannot be asked at runtime, and it is
 * pinned to the type from both directions -- see the assertion below.
 *
 * ⚠️ The cast is unavoidable and harmless: `includes` on a `readonly [...]` of
 * literals will not accept an arbitrary `string`, and widening it here is what
 * lets the predicate take any `SelectionState`. The `satisfies` below is what
 * keeps the names honest.
 */
export type Pinned = Extract<SelectionState, { path: Coordinate[] }>;

const PINNED_PHASES = [
  'routePinned',
  'destinationChosen',
  'targetChosen',
] as const satisfies readonly Pinned['phase'][];

/**
 * ⚠️ **The other half of the guard, and the half `satisfies` cannot give.**
 * `satisfies` checks every name in the array *is* a phase; it says nothing about
 * names left out, so deleting one would leave the type and the predicate
 * consistently wrong and still compile. This fails the build if any phase
 * carrying a path is missing from the array -- the same `never` trick
 * `applyEvents` uses on its event union, pointed at a list instead of a switch.
 */
type NoPinnedPhaseForgotten =
  Exclude<Pinned['phase'], (typeof PINNED_PHASES)[number]> extends never ? true : never;
const allPinnedPhasesListed: NoPinnedPhaseForgotten = true;
void allPinnedPhasesListed;

/** The unit has walked and is choosing what to do: the menu, or the panel. */
export type Arrived = DestinationChosen | TargetChosen;

/**
 * Where a pinned unit is standing, really or in preview -- which is also the
 * tile a second click has to land on to commit the route, and the tile the
 * facing choices are drawn around.
 *
 * ⚠️ **One function, where there were three.** `pinnedDestination` and
 * `facingChoiceOrigin` were this body under two other names, distinguished only
 * by what the caller meant to do next. That is a comment's job, not a
 * function's: three names for one line is three things to keep in step, and the
 * argument type already says which selections may be asked.
 */
export function destinationOf(selection: Pinned): Coordinate {
  return selection.path[selection.path.length - 1];
}

export function isPlan(selection: SelectionState): selection is Pinned {
  return (PINNED_PHASES as readonly string[]).includes(selection.phase);
}

/** A target is picked: the panel opens over it, and nothing is sent yet. */
export function chooseTarget(selection: DestinationChosen, target: Unit): TargetChosen {
  return { ...selection, phase: 'targetChosen', target };
}

/** Back from the panel to the tiles, with the target forgotten. */
export function clearTarget(selection: TargetChosen): DestinationChosen {
  return {
    phase: 'destinationChosen',
    unitId: selection.unitId,
    path: selection.path,
    movement: selection.movement,
    attackTiles: selection.attackTiles,
    facingTiles: selection.facingTiles,
  };
}

/**
 * Which tiles the attack overlay paints, from where the unit ends up.
 *
 * ⚠️ **The whole band, not just what is standing in it** -- reach is the
 * information, so red means *in range* rather than *attackable*.
 *
 * ⚠️ **The four tiles beside the unit are the only place two readings collide**,
 * because for a `min: 1` unit they are facing choices *and* inside the band.
 * Occupancy decides: one with no enemy on it is a facing tile and stays yellow;
 * everything else in the band is red. One rule, and no order to remember.
 */
function attackTilesFor(state: GameState, unit: Unit, from: Coordinate): Coordinate[] {
  const height = state.grid.length;
  const width = state.grid[0]?.length ?? 0;
  return tilesInRange(unit, from, width, height).filter((tile) => {
    if (directionBetween(from, tile) === null) return true; // not one of the four
    const occupant = getUnitAt(state, tile);
    return occupant !== undefined && occupant.owner !== unit.owner;
  });
}

/**
 * The four tiles a unit may turn to look at, clipped to the board.
 *
 * ⚠️ **Moved out of the renderer, which used to derive these from a single
 * coordinate.** Which tiles light is a question about the *selection*, not about
 * painting -- the renderer's job is to colour a list. It also means this logic
 * is testable for the first time: the renderer has no unit tests at all, being
 * WebGL, so "a unit on the top row has three choices" was asserted nowhere.
 *
 * Clipping belongs here rather than at the edge of the grid check, because a
 * facing that points off the board is a strictly worse choice than one that does
 * not, and offering it would be offering nothing.
 */
function facingTilesFor(state: GameState, around: Coordinate): Coordinate[] {
  const height = state.grid.length;
  const width = state.grid[0]?.length ?? 0;
  return [
    { col: around.col, row: around.row + 1 },
    { col: around.col, row: around.row - 1 },
    { col: around.col + 1, row: around.row },
    { col: around.col - 1, row: around.row },
  ].filter((tile) => isWithinGrid(tile, width, height));
}

/**
 * The route is accepted: the unit walks it, and the menu opens on arrival.
 *
 * ⚠️ Takes state to snapshot the attack band, the same way `movement` is
 * snapshotted at selection. That keeps `showSelection` a pure projection of the
 * selection -- it would otherwise need the board to know what to paint -- and
 * the snapshot cannot go stale, because any board change discards the plan.
 */
export function confirmRoute(state: GameState, selection: RoutePinned): DestinationChosen {
  const destination = destinationOf(selection);
  const unit = getUnit(state, selection.unitId);
  return {
    ...selection,
    phase: 'destinationChosen',
    attackTiles: unit ? attackTilesFor(state, { ...unit, position: destination }, destination) : [],
    facingTiles: facingTilesFor(state, destination),
  };
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
 * Which way this click means, or null if it was not one of the four.
 *
 * The four tiles themselves are drawn around `destinationOf`, clipped to the
 * board by the renderer, since the grid's bounds are its business. A unit on
 * the top row simply has three choices, and facing off the board would be a
 * strictly worse one anyway.
 *
 * ⚠️ Answers `null` for the destination *itself*, since `directionBetween`
 * wants a step of exactly one tile. That is what lets the caller tell "keep the
 * direction travelled" from "face this way" without ordering the two by hand.
 */
export function facingChoiceAt(selection: Arrived, coordinate: Coordinate): Facing | null {
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
export function holdFacing(state: GameState, selection: Arrived): Facing | null {
  const previous = selection.path.at(-2);
  const travelled = previous ? directionBetween(previous, destinationOf(selection)) : null;
  return travelled ?? getUnit(state, selection.unitId)?.facing ?? null;
}

/**
 * What a click means once the unit has arrived and the tiles around it are the
 * menu.
 *
 * ⚠️ **One reader, because the order these are asked in is load-bearing.** This
 * was three predicates -- `facingChoiceAt`, `holdFacing`, and an attack check --
 * with the caller trying each until one answered. But `facingChoiceAt` returns a
 * `Facing` for *any* adjacent tile without looking at what is standing on it, so
 * an adjacent enemy satisfies two of them and only the call order separated
 * them: ask facing first and an adjacent enemy can never be attacked. One
 * function makes that unrepresentable rather than merely avoided, and turns the
 * rule into a table a test can walk.
 *
 * ⚠️ `hold` and `face` collapse into one member deliberately. They are different
 * *gestures* -- the unit's own tile versus a tile beside it -- but they produce
 * the same thing, a facing to commit the move with, and nothing downstream
 * branches on which. A second member nothing reads is a second member to keep
 * in step.
 */
export type ActionClick =
  { kind: 'commit'; facing: Facing } | { kind: 'attack'; target: Unit } | { kind: 'cancel' };

export function readActionClick(
  state: GameState,
  selection: DestinationChosen,
  coordinate: Coordinate,
): ActionClick {
  const destination = destinationOf(selection);
  const unit = getUnit(state, selection.unitId);
  if (!unit) return { kind: 'cancel' };

  // ⚠️ **Asked first, and that is the whole point of this function.** An enemy
  // beside the unit is also a facing choice, and whichever question runs first
  // wins. `refuseAttack` is compared against `null` and never against its text
  // -- the reason belongs to the server and changes without the answer changing.
  const target = getUnitAt(state, coordinate);
  if (
    target &&
    refuseAttack(state, { ...unit, position: destination }, destination, target.id) === null
  ) {
    return { kind: 'attack', target };
  }

  // The destination itself: keep the direction travelled.
  if (coordinatesEqual(coordinate, destination)) {
    const facing = holdFacing(state, selection);
    return facing ? { kind: 'commit', facing } : { kind: 'cancel' };
  }

  // One of the four beside it: face that way instead.
  const facing = facingChoiceAt(selection, coordinate);
  return facing ? { kind: 'commit', facing } : { kind: 'cancel' };
}

/** What the panel shows before you commit to a shot. */
export interface Forecast {
  /** Damage at the worst roll, and at the best. The true outcome is one of them. */
  low: number;
  high: number;
  /** Whether the target can shoot back from where you are standing. */
  answered: boolean;
}

/**
 * The numbers on the panel, run through the same formula the server will.
 *
 * ⚠️ **An exact range, not an estimate.** Luck is added last and flat, so the
 * zero-roll result is the true floor and `+ LUCK_MAX` the true ceiling. The
 * client is told the *shape* of the outcome and never which of the ten it will
 * be -- previewing the formula rather than the dice.
 *
 * ⚠️ **The counter's magnitude is deliberately absent.** It is computed on the
 * defender's post-damage health, so it depends on how the attack roll lands, and
 * with health banded the spread comes from band crossings rather than a clean
 * range. A single figure would be true only at the worst roll.
 *
 * ⚠️ `answered` is read at the **worst** roll, where the defender is likeliest
 * to survive. So it means *they will fire back unless you kill them*, which is
 * the pessimistic reading and the right default for a warning.
 */
export function attackForecast(state: GameState, selection: TargetChosen): Forecast | null {
  const attacker = getUnit(state, selection.unitId);
  const target = getUnit(state, selection.target.id);
  if (!attacker || !target) return null;

  // The attacker as it will be standing when it fires, not where state still
  // has it -- the walk was a preview and nothing has been sent.
  const from = destinationOf(selection);
  const moved: Unit = { ...attacker, position: from };

  const low = computeDamage(state, moved, target, 0);
  const high = computeDamage(state, moved, target, LUCK_MAX);
  const survivor: Unit = { ...target, health: Math.max(0, target.health - low) };
  return { low, high, answered: wouldCounter(survivor, from) };
}

/** Which way the unit ends up looking once it commits from the panel. */
export function facingForTarget(state: GameState, selection: TargetChosen): Facing {
  const from = destinationOf(selection);
  const travelled = holdFacing(state, selection) ?? 'north';
  return facingToward(from, selection.target.position, travelled);
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
export function moveCommandFor(selection: Arrived, facing: Facing, targetUnitId?: string): Command {
  const command: Command = {
    type: 'move',
    unitId: selection.unitId,
    path: selection.path,
    facing,
  };
  // Absent rather than undefined: the wire shape is optional, and a key holding
  // undefined is a different thing from a key that is not there.
  if (targetUnitId !== undefined) command.targetUnitId = targetUnitId;
  return command;
}
