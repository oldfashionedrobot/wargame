import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { makeState, route } from '@vod/shared/testing';
import type {
  Command,
  CommandResult,
  Coordinate,
  GameEvent,
  GameServer,
  GameState,
  UpdateListener,
} from '@vod/shared';
import { useGameSession } from './useGameSession';
import type { GameSessionCallbacks } from './useGameSession';

// The hook against a fake in-memory GameServer -- the same interface the real
// polling implementation serves, minus the network. `push` plays the role of a
// poll delivering an update; `respond` scripts what the next submit returns.

const at = (col: number, row: number): Coordinate => ({ col, row });

// b1 can act; its position and infantry's range of 3 make (1,3) a legal move target.
const board = makeState(7, [{ id: 'b1', col: 1, row: 1 }]);

const moved = (): GameEvent => ({
  type: 'unitMoved',
  unitId: 'b1',
  facing: 'north',
  path: [at(1, 1), at(1, 3)],
});

/** One move event covering `tiles` steps -- what the animation gate budgets in. */
const walk = (tiles: number): GameEvent => ({
  type: 'unitMoved',
  unitId: 'b1',
  facing: 'north',
  path: Array.from({ length: tiles + 1 }, (_, step) => at(1, step)),
});

// happy-dom's document.hidden is a prototype getter; an own property shadows
// it for the hidden-tab case below.
function setTabHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
}

afterEach(() => {
  Reflect.deleteProperty(document, 'hidden'); // drop any per-test shadow
  vi.restoreAllMocks();
});

interface FakeServer {
  server: GameServer;
  submissions: Command[];
  push: (events: GameEvent[], state: GameState) => void;
  respond: (result: CommandResult | Promise<CommandResult>) => void;
}

function fakeServer(initial: GameState): FakeServer {
  let state = initial;
  const listeners = new Set<UpdateListener>();
  const submissions: Command[] = [];
  let nextResult: CommandResult | Promise<CommandResult> = {
    ok: false,
    reason: 'no response scripted',
  };

  return {
    server: {
      getState: () => state,
      submit: async (command) => {
        submissions.push(command);
        return nextResult;
      },
      subscribe: (onUpdate) => {
        listeners.add(onUpdate);
        onUpdate([], state);
        return () => listeners.delete(onUpdate);
      },
      dispose: () => listeners.clear(),
    },
    submissions,
    push: (events, next) => {
      state = next;
      for (const listener of listeners) listener(events, next);
    },
    respond: (result) => {
      nextResult = result;
    },
  };
}

function callbacks(): GameSessionCallbacks {
  return {
    onEvents: vi.fn(() => Promise.resolve()),
    onSnap: vi.fn(),
    onPreview: vi.fn(() => Promise.resolve()),
  };
}

function renderSession(fake: FakeServer, initial = callbacks()) {
  return renderHook(({ cb }) => useGameSession(fake.server, cb), {
    initialProps: { cb: initial },
  });
}

describe('useGameSession', () => {
  it('serves the render replica and follows server updates', async () => {
    const fake = fakeServer(board);
    const { result } = renderSession(fake);
    expect(result.current.gameState).toEqual(board);

    const next = makeState(7, [{ id: 'b1', col: 1, row: 3 }]);
    // The commit runs through the queue, a microtask behind the push -- a
    // synchronous act would still see the old state.
    await act(async () => fake.push([], next));
    expect(result.current.gameState).toEqual(next);
  });

  it('forwards events to onEvents', async () => {
    const fake = fakeServer(board);
    const cb = callbacks();
    renderSession(fake, cb);
    await act(async () => fake.push([moved()], board));
    expect(cb.onEvents).toHaveBeenLastCalledWith([moved()]);
  });

  // 5b: a state is committed only after the events that produced it have
  // finished animating. Every batch snaps before it commits; animation is
  // skipped entirely for large catch-up batches and hidden tabs.
  describe('the animation gate', () => {
    it('commits state only after the batch finishes animating', async () => {
      const fake = fakeServer(board);
      const cb = callbacks();
      let finish!: () => void;
      vi.mocked(cb.onEvents).mockImplementation(() => new Promise((res) => (finish = res)));
      const { result } = renderSession(fake, cb);
      await act(async () => {}); // settle the initial (empty, unanimated) batch

      const next = makeState(7, [{ id: 'b1', col: 1, row: 3 }]);
      await act(async () => fake.push([moved()], next));

      // Arrived and animating -- not yet snapped over, not yet committed.
      expect(cb.onEvents).toHaveBeenCalledWith([moved()]);
      expect(cb.onSnap).toHaveBeenCalledTimes(1); // the initial batch only
      expect(result.current.gameState).toEqual(board);

      await act(async () => finish());
      expect(cb.onSnap).toHaveBeenLastCalledWith(next);
      expect(result.current.gameState).toEqual(next);
    });

    it('runs batches serially, in arrival order', async () => {
      const fake = fakeServer(board);
      const cb = callbacks();
      const pending: Array<() => void> = [];
      vi.mocked(cb.onEvents).mockImplementation(() => new Promise((res) => pending.push(res)));
      const { result } = renderSession(fake, cb);
      await act(async () => {});

      const mid = makeState(7, [{ id: 'b1', col: 1, row: 2 }]);
      const end = makeState(7, [{ id: 'b1', col: 1, row: 3 }]);
      await act(async () => fake.push([moved()], mid));
      await act(async () => fake.push([moved()], end));

      // Batch two waits on batch one: its animation has not even started.
      expect(pending).toHaveLength(1);
      expect(result.current.gameState).toEqual(board);

      await act(async () => pending[0]?.());
      // One committed; only now does two animate.
      expect(result.current.gameState).toEqual(mid);
      expect(pending).toHaveLength(2);

      await act(async () => pending[1]?.());
      expect(result.current.gameState).toEqual(end);
    });

    // The threshold is `<=`, so 28 tiles animate and 29 do not.
    // Both sides of the boundary, because only one of them tells you which
    // comparison it is.
    it('still animates a batch of exactly the threshold size', async () => {
      const fake = fakeServer(board);
      const cb = callbacks();
      renderSession(fake, cb);
      await act(async () => {});

      await act(async () => fake.push([walk(28)], board));
      expect(cb.onEvents).toHaveBeenCalled();
    });

    it('snaps instead of animating a large catch-up batch', async () => {
      const fake = fakeServer(board);
      const cb = callbacks();
      const { result } = renderSession(fake, cb);
      await act(async () => {});

      const next = makeState(7, [{ id: 'b1', col: 1, row: 3 }]);
      await act(async () => fake.push([walk(29)], next));

      expect(cb.onEvents).not.toHaveBeenCalled();
      expect(cb.onSnap).toHaveBeenLastCalledWith(next);
      expect(result.current.gameState).toEqual(next);
    });

    // The budget is tiles, not events, because tiles are what take time: three
    // long moves outlast a dozen one-step ones. An event-counting gate passes
    // the two tests above and still sits through this.
    it('snaps a few long moves and animates many short ones', async () => {
      const fake = fakeServer(board);

      const long = callbacks();
      renderSession(fake, long);
      await act(async () => {});
      await act(async () => fake.push([walk(12), walk(12), walk(12)], board));
      expect(long.onEvents).not.toHaveBeenCalled();

      const short = callbacks();
      renderSession(fake, short);
      await act(async () => {});
      await act(async () =>
        fake.push(
          Array.from({ length: 12 }, () => walk(1)),
          board,
        ),
      );
      expect(short.onEvents).toHaveBeenCalled();
    });

    it('snaps instead of animating while the tab is hidden', async () => {
      const fake = fakeServer(board);
      const cb = callbacks();
      const { result } = renderSession(fake, cb);
      await act(async () => {});

      setTabHidden(true);
      const next = makeState(7, [{ id: 'b1', col: 1, row: 3 }]);
      await act(async () => fake.push([moved()], next));

      expect(cb.onEvents).not.toHaveBeenCalled();
      expect(cb.onSnap).toHaveBeenLastCalledWith(next);
      expect(result.current.gameState).toEqual(next);
    });

    // The snap is the correction for a skipped or failed animation, so it
    // must not be able to wedge the queue either.
    it('commits even when the snap itself throws', async () => {
      const fake = fakeServer(board);
      const cb = callbacks();
      vi.mocked(cb.onSnap).mockImplementation(() => {
        throw new Error('renderer disposed');
      });
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { result } = renderSession(fake, cb);
      await act(async () => {});

      const next = makeState(7, [{ id: 'b1', col: 1, row: 3 }]);
      await act(async () => fake.push([moved()], next));

      expect(result.current.gameState).toEqual(next);
      expect(errorLog).toHaveBeenCalled();
    });

    it('snaps over a failed animation and still commits', async () => {
      const fake = fakeServer(board);
      const cb = callbacks();
      vi.mocked(cb.onEvents).mockRejectedValue(new Error('webgl died'));
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { result } = renderSession(fake, cb);
      await act(async () => {});

      const next = makeState(7, [{ id: 'b1', col: 1, row: 3 }]);
      await act(async () => fake.push([moved()], next));

      expect(cb.onSnap).toHaveBeenLastCalledWith(next);
      expect(result.current.gameState).toEqual(next);
      expect(errorLog).toHaveBeenCalled();
    });

    it('clears a rejection on arrival, before the batch finishes animating', async () => {
      const fake = fakeServer(board);
      const cb = callbacks();
      let finish!: () => void;
      vi.mocked(cb.onEvents).mockImplementation(() => new Promise((res) => (finish = res)));
      const { result } = renderSession(fake, cb);
      await act(async () => {});

      fake.respond({ ok: false, reason: 'illegal move' });
      await act(async () => result.current.endTurn());
      expect(result.current.rejection).toBe('illegal move');

      // Newer authority supersedes the rejection the moment it arrives; only
      // the state commit waits on the animation.
      const next = makeState(7, [{ id: 'b1', col: 1, row: 3 }]);
      await act(async () => fake.push([moved()], next));
      expect(result.current.rejection).toBeNull();
      expect(result.current.gameState).toEqual(board);

      await act(async () => finish());
      expect(result.current.gameState).toEqual(next);
    });
  });

  // (1,3) is the destination throughout, so (1,4) is the tile north of it --
  // clicking that is how a facing gets chosen and the move committed.
  const FACE_NORTH = at(1, 4);

  it('pins on click, offers directions on Wait, and submits on a direction', async () => {
    const fake = fakeServer(board);
    const { result } = renderSession(fake, callbacks());
    await act(async () => {}); // settle the initial batch, which would drop a pin

    act(() => result.current.clickTile(at(1, 1)));
    expect(result.current.selection).toMatchObject({ phase: 'unitSelected', unitId: 'b1' });

    await act(async () => result.current.clickTile(at(1, 3)));
    expect(result.current.selection).toMatchObject({ phase: 'destinationChosen', unitId: 'b1' });
    expect(fake.submissions).toEqual([]); // the whole point: nothing has left yet

    fake.respond({ ok: true, seq: 1, events: [], state: board });
    await act(async () => result.current.clickTile(FACE_NORTH));
    expect(fake.submissions).toEqual([
      { type: 'move', unitId: 'b1', path: route(at(1, 1), at(1, 3)), facing: 'north' },
    ]);
    // Cleared the moment the command left, not when the server answered.
    expect(result.current.selection).toEqual({ phase: 'idle' });
  });

  // The skip in playEvents is sound only because the mesh has arrived, so the
  // rule lives here rather than on the button's disabled attribute -- a
  // keyboard shortcut or a direct call would otherwise walk straight past it.
  it('refuses Wait while the preview is still walking', async () => {
    const fake = fakeServer(board);
    const cb = callbacks();
    let arrive!: () => void;
    vi.mocked(cb.onPreview).mockReturnValue(
      new Promise<void>((resolve) => {
        arrive = resolve;
      }),
    );
    const { result } = renderSession(fake, cb);
    await act(async () => {}); // settle the initial batch, which would drop a pin

    act(() => result.current.clickTile(at(1, 1)));
    await act(async () => result.current.clickTile(at(1, 3)));
    expect(result.current.walking).toBe(true);

    await act(async () => result.current.clickTile(FACE_NORTH));
    expect(fake.submissions).toEqual([]); // refused: the mesh is still short
    expect(result.current.selection.phase).toBe('destinationChosen');

    await act(async () => arrive());
    await act(async () => result.current.clickTile(FACE_NORTH));
    expect(fake.submissions).toHaveLength(1);
  });

  // 7d's contract, and the reason the menu waits: while the ghost walks, the
  // mesh is short of the destination, and a confirm there would replay the
  // move from wherever it had got to.
  it('walks the preview on pin, and holds the menu shut until it arrives', async () => {
    const fake = fakeServer(board);
    const cb = callbacks();
    let arrive!: () => void;
    vi.mocked(cb.onPreview).mockReturnValue(
      new Promise<void>((resolve) => {
        arrive = resolve;
      }),
    );
    const { result } = renderSession(fake, cb);
    await act(async () => {}); // settle the initial batch, which would drop a pin

    act(() => result.current.clickTile(at(1, 1)));
    await act(async () => result.current.clickTile(at(1, 3)));

    expect(cb.onPreview).toHaveBeenCalledWith({
      unitId: 'b1',
      path: route(at(1, 1), at(1, 3)),
    });
    expect(result.current.walking).toBe(true);

    await act(async () => arrive());
    expect(result.current.walking).toBe(false);
  });

  // A click that changes nothing must not restart the walk. handleTileClick
  // returns the same object while pinned, which is what this leans on.
  it('does not re-walk when a click lands on an already pinned selection', async () => {
    const fake = fakeServer(board);
    const cb = callbacks();
    const { result } = renderSession(fake, cb);
    await act(async () => {}); // settle the initial batch, which would drop a pin

    act(() => result.current.clickTile(at(1, 1)));
    await act(async () => result.current.clickTile(at(1, 3)));
    expect(cb.onPreview).toHaveBeenCalledTimes(1);

    // ⚠️ Two tiles away, not one: a tile *beside* the destination is a facing
    // and commits, while this backs out -- and backing out is not re-walking.
    await act(async () => result.current.clickTile(at(3, 3)));
    expect(cb.onPreview).toHaveBeenLastCalledWith(null);
    expect(cb.onPreview).toHaveBeenCalledTimes(2);
  });

  // The silence is the design: both of these end with onSnap writing an
  // authoritative position over the mesh, so the correction the renderer
  // already performs is the instruction. Hence no commit verb.
  it('says nothing to the preview on confirm', async () => {
    const fake = fakeServer(board);
    const cb = callbacks();
    const { result } = renderSession(fake, cb);
    await act(async () => {}); // settle the initial batch, which would drop a pin

    act(() => result.current.clickTile(at(1, 1)));
    await act(async () => result.current.clickTile(at(1, 3)));
    vi.mocked(cb.onPreview).mockClear();

    fake.respond({ ok: true, seq: 1, events: [], state: board });
    await act(async () => result.current.clickTile(at(1, 4)));
    expect(cb.onPreview).not.toHaveBeenCalled();
  });

  // The one case nothing else would correct: a rejection produces no update,
  // so snapUnits never runs and the ghost would stand there for good.
  it('puts the unit back when the authority refuses', async () => {
    const fake = fakeServer(board);
    const cb = callbacks();
    const { result } = renderSession(fake, cb);
    await act(async () => {}); // settle the initial batch, which would drop a pin

    act(() => result.current.clickTile(at(1, 1)));
    await act(async () => result.current.clickTile(at(1, 3)));
    fake.respond({ ok: false, reason: 'illegal move' });
    await act(async () => result.current.clickTile(FACE_NORTH));

    expect(cb.onPreview).toHaveBeenLastCalledWith(null);
  });

  it('drops a pinned destination when the board moves underneath it', async () => {
    const fake = fakeServer(board);
    const cb = callbacks();
    const { result } = renderSession(fake, cb);
    await act(async () => {}); // settle the initial batch, which would drop a pin

    act(() => result.current.clickTile(at(1, 1)));
    await act(async () => result.current.clickTile(at(1, 3)));
    expect(result.current.selection.phase).toBe('destinationChosen');

    // An uncommitted plan does not survive the board changing under it -- it
    // may not even be legal any more.
    await act(async () => fake.push([], makeState(7, [{ id: 'b1', col: 1, row: 1 }])));
    expect(result.current.selection).toMatchObject({ phase: 'unitSelected', unitId: 'b1' });
  });

  it('sends nothing at all when a pinned destination is cancelled', async () => {
    const fake = fakeServer(board);
    const cb = callbacks();
    const { result } = renderSession(fake, cb);
    await act(async () => {}); // settle the initial batch, which would drop a pin

    act(() => result.current.clickTile(at(1, 1)));
    await act(async () => result.current.clickTile(at(1, 3)));
    // Neither the destination nor beside it, so it means back out.
    await act(async () => result.current.clickTile(at(3, 3)));

    expect(fake.submissions).toEqual([]);
    expect(cb.onPreview).toHaveBeenLastCalledWith(null); // and the ghost goes home
    // Still selected, standing where it started, ready to pick again.
    expect(result.current.selection).toMatchObject({
      phase: 'unitSelected',
      unitId: 'b1',
      position: at(1, 1),
    });
  });

  // ⚠️ Everything lit answers the pin; everything else backs out of it. There
  // is no third reading, which is what lets the range coming down carry the
  // whole rule.
  it('treats a tile click that means neither as a cancel', async () => {
    const fake = fakeServer(board);
    const { result } = renderSession(fake, callbacks());
    await act(async () => {}); // settle the initial batch, which would drop a pin

    act(() => result.current.clickTile(at(1, 1)));
    await act(async () => result.current.clickTile(at(1, 3)));

    // Reachable, but neither the destination nor beside it.
    await act(async () => result.current.clickTile(at(3, 3)));
    expect(result.current.selection).toMatchObject({ phase: 'unitSelected', unitId: 'b1' });
    expect(fake.submissions).toEqual([]);
  });

  // The gesture the merge is for: the destination itself keeps the direction
  // travelled, so the common move is one click rather than a menu and a click.
  it('commits on the destination itself, facing the way it travelled', async () => {
    const fake = fakeServer(board);
    const { result } = renderSession(fake, callbacks());
    await act(async () => {}); // settle the initial batch, which would drop a pin

    act(() => result.current.clickTile(at(1, 1)));
    await act(async () => result.current.clickTile(at(1, 3)));
    await act(async () => result.current.clickTile(at(1, 3)));

    expect(fake.submissions).toEqual([
      { type: 'move', unitId: 'b1', path: route(at(1, 1), at(1, 3)), facing: 'north' },
    ]);
  });

  // Invariant 1, and the one place it can be observed: the replica lags on
  // purpose while a batch animates, so a click landing in that window must
  // read `server.getState()` -- the authority, already ahead -- and not the
  // state React is still showing. Nothing else in this suite distinguishes
  // them, because the fake normally moves both in lockstep.
  it('clicks against the authority, not the replica it is still displaying', async () => {
    const fake = fakeServer(board);
    const cb = callbacks();
    let finishAnimating!: () => void;
    vi.mocked(cb.onEvents).mockImplementation(() => new Promise((res) => (finishAnimating = res)));
    const { result } = renderSession(fake, cb);
    await act(async () => {});

    // b1 has moved to (1,3) as far as the server is concerned, and the batch
    // is still animating -- so the replica still has it at (1,1).
    const movedState = makeState(7, [{ id: 'b1', col: 1, row: 3 }]);
    await act(async () => fake.push([moved()], movedState));
    expect(result.current.gameState).toEqual(board); // replica: still at (1,1)

    // Clicking the unit where the *authority* has it must select it. Reading
    // the replica would find an empty tile there and select nothing.
    await act(async () => result.current.clickTile(at(1, 3)));
    expect(result.current.selection).toMatchObject({ phase: 'unitSelected', unitId: 'b1' });

    await act(async () => finishAnimating());
  });

  it('sets rejection and rolls back to the unit, not to the refused destination', async () => {
    const fake = fakeServer(board);
    const { result } = renderSession(fake, callbacks());
    await act(async () => {}); // settle the initial batch, which would drop a pin

    act(() => result.current.clickTile(at(1, 1)));
    await act(async () => result.current.clickTile(at(1, 3)));
    fake.respond({ ok: false, reason: 'illegal move' });
    await act(async () => result.current.clickTile(FACE_NORTH));

    expect(result.current.rejection).toBe('illegal move');
    // Handing back the pin would invite the player to confirm the very move
    // the server just refused.
    expect(result.current.selection).toMatchObject({
      phase: 'unitSelected',
      unitId: 'b1',
      position: at(1, 1),
    });
  });

  it('clears the rejection on the next server update', async () => {
    const fake = fakeServer(board);
    const { result } = renderSession(fake);
    fake.respond({ ok: false, reason: 'illegal move' });
    await act(async () => result.current.endTurn());
    expect(result.current.rejection).toBe('illegal move');

    act(() => fake.push([], board));
    expect(result.current.rejection).toBeNull();
  });

  // The hazard the extraction had to dodge: subscribe fires synchronously and
  // clears the rejection, so if the subscription depended on the callbacks'
  // identities, a re-render with fresh callbacks would re-subscribe and wipe a
  // rejection before anyone saw it. The latest-ref keeps the subscription on
  // `server` alone; this fails if that regresses.
  it('keeps the rejection across re-renders with new callback identities', async () => {
    const fake = fakeServer(board);
    const { result, rerender } = renderSession(fake);
    fake.respond({ ok: false, reason: 'illegal move' });
    await act(async () => result.current.endTurn());
    expect(result.current.rejection).toBe('illegal move');

    rerender({ cb: callbacks() });
    expect(result.current.rejection).toBe('illegal move');
  });

  // The hook is written against the interface: the real implementation never
  // rejects, but one that does must read as a rejection and release the
  // in-flight guard, not soft-lock the UI forever.
  it('treats a rejecting submit as a rejection and releases the guard', async () => {
    const fake = fakeServer(board);
    const { result } = renderSession(fake);

    const failure = Promise.reject(new Error('implementation broke'));
    // Pre-handle so the runner never sees an unhandled rejection; the await
    // inside the hook still receives the rejection.
    failure.catch(() => {});
    fake.respond(failure);
    await act(async () => result.current.endTurn());
    expect(result.current.rejection).toBe('implementation broke');

    // The guard released: the next submit goes through.
    fake.respond({ ok: true, seq: 1, events: [], state: board });
    await act(async () => result.current.endTurn());
    expect(fake.submissions).toHaveLength(2);
  });

  it('ignores clicks while a submit is in flight', async () => {
    const fake = fakeServer(board);
    const cb = callbacks();
    const { result } = renderSession(fake, cb);

    await act(async () => {}); // settle the initial batch, which would drop a pin
    act(() => result.current.clickTile(at(1, 1)));
    await act(async () => result.current.clickTile(at(1, 3)));
    let release!: (result: CommandResult) => void;
    fake.respond(new Promise<CommandResult>((res) => (release = res)));

    await act(async () => result.current.clickTile(FACE_NORTH)); // in flight now
    const during = result.current.selection;
    act(() => result.current.clickTile(at(1, 1))); // swallowed by the guard
    expect(fake.submissions).toHaveLength(1);
    expect(result.current.selection).toBe(during);

    release({ ok: true, seq: 1, events: [], state: board });
    await act(async () => {});
  });

  it('endTurn submits and clears the selection', async () => {
    const fake = fakeServer(board);
    const cb = callbacks();
    const { result } = renderSession(fake, cb);
    act(() => result.current.clickTile(at(1, 1)));

    fake.respond({ ok: true, seq: 1, events: [], state: board });
    await act(async () => result.current.endTurn());
    expect(fake.submissions).toEqual([{ type: 'endTurn' }]);
    expect(result.current.selection).toEqual({ phase: 'idle' });
  });
});
