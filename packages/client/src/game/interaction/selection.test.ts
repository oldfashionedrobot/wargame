import { describe, expect, it } from 'vitest';
import { makeState, route } from '@vod/shared/testing';
import type { Coordinate, GameState } from '@vod/shared';
import {
  handleTileClick,
  initialSelectionState,
  moveCommandFor,
  unpinDestination,
} from './selection';
import type { DestinationChosen, SelectionState } from './selection';

// The pure half of the client: state and a coordinate in, a new selection out.
// No React, no Babylon, no server. A click never produces a command -- it picks
// a destination -- so committing is `moveCommandFor` and abandoning is
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

/** Select b1, then pin `destination`. */
function withB1Pinned(state: GameState, destination: Coordinate): DestinationChosen {
  const pinned = handleTileClick(state, withB1Selected(state), destination);
  if (pinned.phase !== 'destinationChosen') throw new Error('expected a pinned destination');
  return pinned;
}

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
  // per unit type -- every other fixture is infantry, so a hardcoded budget of
  // 3 would pass the whole suite. Cavalry reaches twice as far.
  it("reads each unit type's own movement range from the catalog", () => {
    const state = makeState(9, [
      { id: 'foot', col: 4, row: 4 },
      { id: 'horse', col: 4, row: 0, unitTypeId: 'cavalry' },
    ]);
    const infantry = handleTileClick(state, initialSelectionState, at(4, 4));
    const cavalry = handleTileClick(state, initialSelectionState, at(4, 0));
    if (infantry.phase !== 'unitSelected' || cavalry.phase !== 'unitSelected') throw new Error();

    // Four steps from either unit: beyond infantry's 3, inside cavalry's 5.
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
  it('pins a reachable tile rather than committing it', () => {
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

describe('a destination pinned', () => {
  it('ignores tile clicks, returning the very same selection', () => {
    const state = board();
    const pinned = withB1Pinned(state, at(1, 3));
    // Identity, not equality: the menu owns the decision, and a re-render for
    // a click that changes nothing is waste React can see.
    expect(handleTileClick(state, pinned, at(2, 2))).toBe(pinned);
    expect(handleTileClick(state, pinned, at(1, 1))).toBe(pinned);
  });

  it('commits the pinned path exactly, and nothing else', () => {
    const state = board();
    expect(moveCommandFor(withB1Pinned(state, at(1, 3)))).toEqual({
      type: 'move',
      unitId: 'b1',
      path: route(at(1, 1), at(1, 3)),
    });
  });

  // Cancel goes back to a selected unit rather than to idle, so the next click
  // picks a different destination instead of re-selecting.
  it('unpins to the unit selected where it still stands', () => {
    const state = board();
    const pinned = withB1Pinned(state, at(1, 3));
    const back = unpinDestination(pinned);
    expect(back).toMatchObject({ phase: 'unitSelected', unitId: 'b1', position: at(1, 1) });
    if (back.phase !== 'unitSelected') return;
    expect(back.movement).toBe(pinned.movement); // the same snapshot, not a new search
  });
});
