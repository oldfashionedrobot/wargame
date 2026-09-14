import { describe, expect, it } from 'vitest';
import { makeState, route, unitAt } from '@vod/shared/testing';
import type { Coordinate, GameState } from '@vod/shared';
import {
  confirmRoute,
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
  confirmRoute(withB1Pinned(state, destination));

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
    const arrived = confirmRoute(pinned);
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
