import { describe, expect, it } from 'vitest';
import { makeState, route, unitAt } from '@vod/shared/testing';
import { LUCK_MAX } from '@vod/shared';
import type { Coordinate, GameState } from '@vod/shared';
import {
  attackForecast,
  chooseTarget,
  clearTarget,
  confirmRoute,
  facingForTarget,
  isPlan,
  readActionClick,
  facingChoiceAt,
  facingChoiceOrigin,
  handleTileClick,
  initialSelectionState,
  moveCommandFor,
  unpinDestination,
  holdFacing,
} from './selection';
import type { DestinationChosen, RoutePinned, SelectionState } from './selection';

// The pure half of the client: state and a coordinate in, a new selection out.
// No React, no Babylon, no server. `handleTileClick` never produces a command
// -- it picks a destination -- so committing is `moveCommandFor` and abandoning
// is
// `unpinDestination`, both driven by the menu.
//
// Blue to move. b1 is free, b2 has already acted, r1 belongs to the opponent.
const board = (): GameState =>
  makeState(7, [
    { id: 'b1', col: 1, row: 1 },
    { id: 'b2', col: 5, row: 5, hasActed: true },
    { id: 'r1', col: 6, row: 6, owner: 'red' },
  ]);

const at = (col: number, row: number): Coordinate => ({ col, row });

/** Select b1 and hand back the resulting selection, since most cases start there. */
const withB1Selected = (state: GameState): SelectionState =>
  handleTileClick(state, initialSelectionState, at(1, 1));

/** Select b1, then pin a route to `destination`. Nothing has walked yet. */
function withB1Pinned(state: GameState, destination: Coordinate): RoutePinned {
  const pinned = handleTileClick(state, withB1Selected(state), destination);
  if (pinned.phase !== 'routePinned') throw new Error('expected a pinned route');
  return pinned;
}

/** Pin a route and confirm it: the phase the menu and the facing choice live in. */
const withB1Arrived = (state: GameState, destination: Coordinate): DestinationChosen =>
  confirmRoute(state, withB1Pinned(state, destination));

describe('handleTileClick, nothing selected', () => {
  it('selects a unit that can act, snapshotting its position and range', () => {
    const selection = handleTileClick(board(), initialSelectionState, at(1, 1));
    expect(selection.phase).toBe('unitSelected');
    if (selection.phase !== 'unitSelected') return;
    expect(selection.unitId).toBe('b1');
    expect(selection.position).toEqual(at(1, 1));
    // Infantry's 3 movement points on plains: the tiles within three
    // orthogonal steps of (1,1) that fit on a 7x7 board, minus its own. Being
    // near two edges clips the diamond, which is why this is 16 and not 24.
    expect(selection.movement.reachable).toHaveLength(16);
  });

  // Nothing else in the client pins that movement stats come from the catalog
  // per unit type -- every other fixture is infantry, so one hardcoded budget
  // would pass the whole suite.
  //
  // ⚠️ Four is the *only* distance that separates them, infantry having 3 and
  // cavalry 4. Both assertions sit on it deliberately, and the catalog has
  // moved twice already -- so when it moves again, this is the test that moves
  // with it rather than the one that quietly stops discriminating.
  it("reads each unit type's own movement range from the catalog", () => {
    const state = makeState(9, [
      { id: 'foot', col: 4, row: 4 },
      { id: 'horse', col: 4, row: 0, unitTypeId: 'cavalry' },
    ]);
    const infantry = handleTileClick(state, initialSelectionState, at(4, 4));
    const cavalry = handleTileClick(state, initialSelectionState, at(4, 0));
    if (infantry.phase !== 'unitSelected' || cavalry.phase !== 'unitSelected') throw new Error();

    // Four steps from either unit: beyond infantry's 3, exactly cavalry's 4.
    expect(infantry.movement.pathTo(at(4, 8))).toBeNull();
    expect(cavalry.movement.pathTo(at(4, 4))).not.toBeNull();
  });

  it('ignores an empty tile', () => {
    const selection = handleTileClick(board(), initialSelectionState, at(3, 3));
    expect(selection).toEqual(initialSelectionState);
  });

  it('ignores an enemy unit', () => {
    const selection = handleTileClick(board(), initialSelectionState, at(6, 6));
    expect(selection).toEqual(initialSelectionState);
  });

  // Selection is a preview of a game rule, not a UI whim -- canSelectUnit is
  // the same predicate the server enforces.
  it('ignores an own unit that has already acted', () => {
    const selection = handleTileClick(board(), initialSelectionState, at(5, 5));
    expect(selection).toEqual(initialSelectionState);
  });
});

describe('handleTileClick, a unit selected', () => {
  it('pins a route to a reachable tile rather than walking it', () => {
    const state = board();
    const pinned = withB1Pinned(state, at(1, 3));
    expect(pinned.path).toEqual(route(at(1, 1), at(1, 3)));
    // The unit has not moved and nothing has been sent -- path[0] is still
    // where it stands, which is what Cancel restores it to.
    expect(pinned.path[0]).toEqual(at(1, 1));
  });

  // AW's answer to "how do you act without moving": the unit's own tile is a
  // destination like any other, so no gesture of its own is needed.
  it('pins in place when the selected unit is clicked again', () => {
    const state = board();
    const pinned = withB1Pinned(state, at(1, 1));
    expect(pinned.path).toEqual([at(1, 1)]);
  });

  it('clears the selection on an unreachable empty tile, without a command', () => {
    const state = board();
    const selection = handleTileClick(state, withB1Selected(state), at(6, 1));
    expect(selection).toEqual(initialSelectionState);
  });

  // b3 is five tiles away, well outside infantry's range of 3, so this is the
  // out-of-range case: a click that is neither a move nor a deselect still
  // finds a selectable unit. The in-range case -- where the friendly-occupancy
  // rule is what stops it being a move -- is the test below.
  it('selects another of your units even when it is out of range', () => {
    const state = makeState(7, [
      { id: 'b1', col: 1, row: 1 },
      { id: 'b3', col: 6, row: 1 },
    ]);
    const selection = handleTileClick(state, withB1Selected(state), at(6, 1));
    expect(selection).toMatchObject({ phase: 'unitSelected', unitId: 'b3' });
  });

  // A friendly unit is pass-through but not a stopping point, so its tile is
  // never in reachableTiles -- clicking it must reselect, never move.
  it('reselects rather than moving when a friendly unit stands in range', () => {
    const state = makeState(7, [
      { id: 'b1', col: 1, row: 1 },
      { id: 'b3', col: 1, row: 2 },
    ]);
    const selection = handleTileClick(state, withB1Selected(state), at(1, 2));
    expect(selection).toMatchObject({ phase: 'unitSelected', unitId: 'b3' });
  });

  it('does not offer a move onto an enemy', () => {
    const state = makeState(7, [
      { id: 'b1', col: 1, row: 1 },
      { id: 'r1', col: 1, row: 2, owner: 'red' },
    ]);
    const selection = handleTileClick(state, withB1Selected(state), at(1, 2));
    expect(selection).toEqual(initialSelectionState);
  });

  it('recovers if the selected unit has vanished from state', () => {
    const state = board();
    const stale = withB1Selected(state);
    const without: GameState = { ...state, units: state.units.filter((u) => u.id !== 'b1') };
    const selection = handleTileClick(without, stale, at(3, 3));
    expect(selection).toEqual(initialSelectionState);
  });
});

// ⚠️ A pinned route is still being chosen, so unlike the menu phase below it
// keeps answering tile clicks. That is what makes the second click a confirm
// rather than a commit: nothing has moved, and every reachable tile is live.
describe('a route pinned', () => {
  it('re-pins to another reachable tile', () => {
    const state = board();
    const repinned = handleTileClick(state, withB1Pinned(state, at(1, 3)), at(3, 1));
    expect(repinned).toMatchObject({ phase: 'routePinned', unitId: 'b1' });
    if (repinned.phase !== 'routePinned') return;
    expect(repinned.path.at(-1)).toEqual(at(3, 1));
    expect(repinned.path[0]).toEqual(at(1, 1)); // still where it really stands
  });

  // Re-pinning runs the same code that pinned it, so the snapshot taken at
  // selection is carried rather than a fresh search being run per click.
  it('carries the original search rather than re-exploring', () => {
    const state = board();
    const pinned = withB1Pinned(state, at(1, 3));
    const repinned = handleTileClick(state, pinned, at(3, 1));
    if (repinned.phase !== 'routePinned') throw new Error('expected a pinned route');
    expect(repinned.movement).toBe(pinned.movement);
  });

  it('re-pins onto the unit itself, which is standing still', () => {
    const state = board();
    const staying = handleTileClick(state, withB1Pinned(state, at(1, 3)), at(1, 1));
    expect(staying).toMatchObject({ phase: 'routePinned' });
    if (staying.phase !== 'routePinned') return;
    expect(staying.path).toEqual([at(1, 1)]);
  });

  it('cancels on a tile outside the range, without a command', () => {
    const state = board();
    expect(handleTileClick(state, withB1Pinned(state, at(1, 3)), at(6, 1))).toEqual(
      initialSelectionState,
    );
  });

  it('unpins to the unit selected where it still stands', () => {
    const state = board();
    const pinned = withB1Pinned(state, at(1, 3));
    const back = unpinDestination(pinned);
    expect(back).toMatchObject({ phase: 'unitSelected', unitId: 'b1', position: at(1, 1) });
    if (back.phase !== 'unitSelected') return;
    expect(back.movement).toBe(pinned.movement); // the same snapshot, not a new search
  });
});

describe('a destination arrived at', () => {
  it('ignores tile clicks, returning the very same selection', () => {
    const state = board();
    const arrived = withB1Arrived(state, at(1, 3));
    // Identity, not equality: the menu owns the decision, and a re-render for
    // a click that changes nothing is waste React can see.
    expect(handleTileClick(state, arrived, at(2, 2))).toBe(arrived);
    expect(handleTileClick(state, arrived, at(1, 1))).toBe(arrived);
  });

  it('lights the four directions around the destination, not the origin', () => {
    expect(facingChoiceOrigin(withB1Arrived(board(), at(1, 3)))).toEqual(at(1, 3));
  });

  // Confirming carries the plan across untouched -- only the phase moves, so
  // the path the command is built from cannot drift at the handover.
  it('keeps the path and the search when the route is confirmed', () => {
    const state = board();
    const pinned = withB1Pinned(state, at(1, 3));
    const arrived = confirmRoute(state, pinned);
    expect(arrived.path).toBe(pinned.path);
    expect(arrived.movement).toBe(pinned.movement);
  });

  // Cancel goes back to a selected unit rather than to idle, so the next click
  // picks a different destination instead of re-selecting.
  it('unpins to the unit selected where it still stands', () => {
    const state = board();
    const back = unpinDestination(withB1Arrived(state, at(1, 3)));
    expect(back).toMatchObject({ phase: 'unitSelected', unitId: 'b1', position: at(1, 1) });
  });
});

describe('choosing a facing', () => {
  const choosing = (destination: Coordinate): DestinationChosen =>
    withB1Arrived(board(), destination);

  it('reads a click on an adjacent tile as that direction', () => {
    const facing = choosing(at(1, 3));
    expect(facingChoiceAt(facing, at(1, 4))).toBe('north');
    expect(facingChoiceAt(facing, at(1, 2))).toBe('south');
    expect(facingChoiceAt(facing, at(2, 3))).toBe('east');
    expect(facingChoiceAt(facing, at(0, 3))).toBe('west');
  });

  it('ignores a click that is not one orthogonal step away', () => {
    const facing = choosing(at(1, 3));
    expect(facingChoiceAt(facing, at(2, 4))).toBeNull(); // diagonal
    expect(facingChoiceAt(facing, at(1, 5))).toBeNull(); // two away
  });

  // ⚠️ The destination answers null here rather than a direction, and that is
  // what lets the caller tell "keep travelling" from "face this way" without
  // ordering the two by hand. `holdFacing` is what answers it instead.
  it('answers null for the destination itself, which holdFacing covers', () => {
    const state = board();
    const facing = choosing(at(1, 3));
    expect(facingChoiceAt(facing, at(1, 3))).toBeNull();
    expect(holdFacing(state, facing)).toBe('north'); // b1 walked 1,1 -> 1,3
  });

  // Acting without moving has no last step to read a direction off, so the
  // unit keeps the facing it already had.
  it('keeps the current facing when the path never left the tile', () => {
    const state = board();
    const staying = withB1Arrived(state, at(1, 1));
    expect(staying.path).toEqual([at(1, 1)]);
    expect(holdFacing(state, staying)).toBe(unitAt(state, 'b1').facing);
  });

  it('still ignores tile clicks as far as the selection goes', () => {
    const facing = choosing(at(1, 3));
    // The direction is read by facingChoiceAt; handleTileClick must not also
    // reselect or clear on the same click.
    expect(handleTileClick(board(), facing, at(1, 4))).toBe(facing);
    expect(handleTileClick(board(), facing, at(5, 5))).toBe(facing);
  });

  it('commits the pinned path with the direction the player chose', () => {
    const facing = choosing(at(1, 3));
    expect(moveCommandFor(facing, 'west')).toEqual({
      type: 'move',
      unitId: 'b1',
      path: route(at(1, 1), at(1, 3)),
      facing: 'west',
    });
  });

  it('cancels back to the unit where it really stands', () => {
    const back = unpinDestination(choosing(at(1, 3)));
    expect(back).toMatchObject({ phase: 'unitSelected', unitId: 'b1', position: at(1, 1) });
  });
});

// ⚠️ The table the three predicates could not be tested as. With them, the only
// thing a test could pin was *call order*; here the rule is one function and
// each reading is a case.
describe('readActionClick', () => {
  // b1 infantry at (1,1), range 1..2. An enemy sits beside it and another two
  // tiles off; a friend sits beside it too.
  const field = () =>
    makeState(7, [
      { id: 'b1', col: 1, row: 1 },
      { id: 'friend', col: 1, row: 2 },
      { id: 'adjacent', col: 2, row: 1, owner: 'red' },
      { id: 'distant', col: 3, row: 1, owner: 'red' },
      { id: 'far', col: 5, row: 5, owner: 'red' },
    ]);
  const arrived = (state: GameState) => confirmRoute(state, withB1Pinned(state, at(1, 1)));

  it('reads the unit’s own tile as a commit keeping its facing', () => {
    const state = field();
    expect(readActionClick(state, arrived(state), at(1, 1))).toEqual({
      kind: 'commit',
      facing: unitAt(state, 'b1').facing,
    });
  });

  it('reads an empty tile beside it as a commit facing that way', () => {
    const state = field();
    expect(readActionClick(state, arrived(state), at(0, 1))).toEqual({
      kind: 'commit',
      facing: 'west',
    });
  });

  // ⚠️ **The case the old shape could get wrong.** This tile is adjacent, so
  // `facingChoiceAt` answers a `Facing` for it — and it holds an enemy in range.
  // Whichever question ran first decided, and nothing said which.
  it('reads an adjacent enemy as an attack, not as a facing', () => {
    const state = field();
    const click = readActionClick(state, arrived(state), at(2, 1));
    expect(click.kind).toBe('attack');
    if (click.kind !== 'attack') return;
    expect(click.target.id).toBe('adjacent');
  });

  it('reads an enemy further off but still in range as an attack', () => {
    const state = field();
    const click = readActionClick(state, arrived(state), at(3, 1));
    expect(click).toMatchObject({ kind: 'attack' });
  });

  it('reads an enemy out of range as a cancel', () => {
    const state = field();
    expect(readActionClick(state, arrived(state), at(5, 5))).toEqual({ kind: 'cancel' });
  });

  // A friend beside the unit is not a target, so the tile keeps its other
  // meaning: you may turn to look at it.
  it('reads a friendly tile beside it as a facing, not an attack', () => {
    const state = field();
    expect(readActionClick(state, arrived(state), at(1, 2))).toEqual({
      kind: 'commit',
      facing: 'north',
    });
  });

  it('reads anything further away as a cancel', () => {
    const state = field();
    expect(readActionClick(state, arrived(state), at(4, 4))).toEqual({ kind: 'cancel' });
  });

  // Artillery cannot hit what has reached it, so an adjacent enemy is a facing
  // choice again -- the same tile reading differently for a different unit,
  // decided by the range band and nothing else.
  it('reads an adjacent enemy as a facing when the unit cannot shoot that close', () => {
    const gunline = makeState(7, [
      { id: 'b1', col: 1, row: 1, unitTypeId: 'artillery' },
      { id: 'adjacent', col: 2, row: 1, owner: 'red' },
    ]);
    expect(readActionClick(gunline, arrived(gunline), at(2, 1))).toEqual({
      kind: 'commit',
      facing: 'east',
    });
  });
});

describe('the panel, and what it is told', () => {
  // b1 infantry at (1,1); an enemy two north, which infantry can reach.
  // ⚠️ The enemy's facing is stated rather than inherited: b1 attacks from the
  // south, and a shot from directly behind is never answered, so leaving it to
  // the fixture default would make "they return fire" depend on something these
  // tests do not mention.
  const field = () =>
    makeState(7, [
      { id: 'b1', col: 1, row: 1 },
      { id: 'r1', col: 1, row: 3, owner: 'red', facing: 'south' },
    ]);
  const panel = (state: GameState) =>
    chooseTarget(confirmRoute(state, withB1Pinned(state, at(1, 1))), unitAt(state, 'r1'));

  // ⚠️ An exact range, not an estimate: luck is added last and flat, so the
  // zero-roll result is the true floor and the spread is exactly LUCK_MAX.
  it('forecasts a range whose width is the luck band', () => {
    const state = field();
    const forecast = attackForecast(state, panel(state));
    expect(forecast).not.toBeNull();
    if (!forecast) return;
    expect(forecast.high - forecast.low).toBe(LUCK_MAX);
    expect(forecast.low).toBeGreaterThan(0);
  });

  it('says they return fire when the target can reach back', () => {
    const state = field();
    expect(attackForecast(state, panel(state))?.answered).toBe(true);
  });

  // ⚠️ The panel got the rear rule without being edited for it -- it reads
  // `wouldCounter`, which reads facing, so the same shot against a target
  // looking away simply stops promising return fire. That is what this asserts:
  // not that the rule is right, which `combat.test.ts` owns, but that the
  // forecast is wired to the rule the server will actually resolve.
  it('says nothing about return fire when the target is looking away', () => {
    const state = makeState(7, [
      { id: 'b1', col: 1, row: 1 },
      { id: 'r1', col: 1, row: 3, owner: 'red', facing: 'north' },
    ]);
    const chosen = chooseTarget(
      confirmRoute(state, withB1Pinned(state, at(1, 1))),
      unitAt(state, 'r1'),
    );
    expect(attackForecast(state, chosen)?.answered).toBe(false);
    // ⚠️ And the damage is untouched: facing changes who may answer, never what
    // the shot does. A flanking bonus would show up right here, and does not --
    // the same shot against the same unit turned around forecasts the same
    // number, which is the assertion that would have to be deleted to add one.
    const head = field();
    expect(attackForecast(state, chosen)?.low).toBe(attackForecast(head, panel(head))?.low);
  });

  // The whole point of outranging someone: a gun firing from four is never
  // answered, and the panel has to say so before you commit rather than after.
  it('says nothing about return fire when the target cannot reach', () => {
    const state = makeState(9, [
      { id: 'b1', col: 1, row: 1, unitTypeId: 'artillery' },
      { id: 'r1', col: 1, row: 5, owner: 'red' },
    ]);
    const chosen = chooseTarget(
      confirmRoute(state, withB1Pinned(state, at(1, 1))),
      unitAt(state, 'r1'),
    );
    expect(attackForecast(state, chosen)?.answered).toBe(false);
  });

  it('points the unit at its target, however far off it is', () => {
    const state = field();
    expect(facingForTarget(state, panel(state))).toBe('north');

    const diagonal = makeState(9, [
      { id: 'b1', col: 1, row: 1, unitTypeId: 'artillery' },
      { id: 'r1', col: 4, row: 2, owner: 'red' },
    ]);
    const chosen = chooseTarget(
      confirmRoute(diagonal, withB1Pinned(diagonal, at(1, 1))),
      unitAt(diagonal, 'r1'),
    );
    expect(facingForTarget(diagonal, chosen)).toBe('east');
  });

  // ⚠️ Backing out of the panel returns to the tiles with the unit still
  // standing where it walked -- not to the board. The plan is still a plan.
  it('backs out to the menu with the walk intact', () => {
    const state = field();
    const back = clearTarget(panel(state));
    expect(back.phase).toBe('destinationChosen');
    expect(back.path).toEqual(panel(state).path);
    expect(back.attackTiles).toEqual(panel(state).attackTiles);
  });

  // ⚠️ The check that catches a fourth phase being forgotten: every phase that
  // carries a path is a plan a board change must discard.
  it('counts as an uncommitted plan, like every other phase carrying a path', () => {
    const state = field();
    expect(isPlan(panel(state))).toBe(true);
    expect(isPlan(withB1Pinned(state, at(1, 1)))).toBe(true);
    expect(isPlan(confirmRoute(state, withB1Pinned(state, at(1, 1))))).toBe(true);
    expect(isPlan(initialSelectionState)).toBe(false);
    expect(isPlan(withB1Selected(state))).toBe(false);
  });
});

describe('attackTiles, which the overlay paints', () => {
  const has = (tiles: Coordinate[], col: number, row: number) =>
    tiles.some((tile) => tile.col === col && tile.row === row);
  const tilesFor = (state: GameState) =>
    confirmRoute(state, withB1Pinned(state, at(1, 1))).attackTiles;

  // ⚠️ The rule the colours rest on: the four tiles beside the unit are facing
  // choices *and* inside a min-1 band, and occupancy is what separates them.
  it('leaves an empty tile beside the unit to the facing overlay', () => {
    const tiles = tilesFor(makeState(7, [{ id: 'b1', col: 1, row: 1 }]));
    expect(has(tiles, 1, 2)).toBe(false); // adjacent and empty: yellow
    expect(has(tiles, 1, 3)).toBe(true); // two out: red
  });

  it('claims an adjacent tile back the moment an enemy stands on it', () => {
    const tiles = tilesFor(
      makeState(7, [
        { id: 'b1', col: 1, row: 1 },
        { id: 'r1', col: 1, row: 2, owner: 'red' },
      ]),
    );
    expect(has(tiles, 1, 2)).toBe(true);
  });

  // A friend beside you is not a target, so the tile keeps its other meaning.
  it('leaves an adjacent friend to the facing overlay', () => {
    const tiles = tilesFor(
      makeState(7, [
        { id: 'b1', col: 1, row: 1 },
        { id: 'b2', col: 1, row: 2 },
      ]),
    );
    expect(has(tiles, 1, 2)).toBe(false);
  });

  // Artillery cannot shoot what has reached it, so its band starts two out and
  // the adjacent rule never even applies.
  it('never includes what a minimum range forbids', () => {
    const tiles = tilesFor(
      makeState(9, [
        { id: 'b1', col: 1, row: 1, unitTypeId: 'artillery' },
        { id: 'r1', col: 1, row: 2, owner: 'red' },
      ]),
    );
    expect(has(tiles, 1, 2)).toBe(false);
    expect(has(tiles, 1, 3)).toBe(true);
  });
});
