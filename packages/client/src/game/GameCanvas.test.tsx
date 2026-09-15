import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Coordinate, GameEvent, GameServer, GameState } from '@vod/shared';
import type { ConnectionStatus } from '../net/gameServer';
import { makeState } from '@vod/shared/testing';
import { GameCanvas } from './GameCanvas';
import type { GameRenderer } from './render/renderer';

// The renderer is the seam: it builds a Babylon engine, which needs WebGL that
// happy-dom does not have. Everything below is the wiring around it -- the
// chrome, the lifecycle, and the three callbacks the session pushes through.
vi.mock('./render/renderer', () => ({ createGameRenderer: vi.fn() }));
const { createGameRenderer } = await import('./render/renderer');

let renderer: GameRenderer;
let clickTile: (coordinate: Coordinate) => void;

const board: GameState = makeState(5, [{ id: 'b1', col: 1, row: 1 }]);

beforeEach(() => {
  vi.clearAllMocks();
  renderer = {
    onTileClick: vi.fn((handler: (c: Coordinate) => void) => {
      clickTile = handler;
    }),
    setSelectedTile: vi.fn(),
    setRange: vi.fn(),
    setAttackRange: vi.fn(),
    setChargeTargets: vi.fn(),
    setRoute: vi.fn(),
    anchorTo: vi.fn(),
    playEvents: vi.fn(() => Promise.resolve()),
    syncUnits: vi.fn(),
    setFacingChoices: vi.fn(),
    previewMove: vi.fn(() => Promise.resolve()),
    cancelPreview: vi.fn(),
    toggleInspector: vi.fn(),
    dispose: vi.fn(),
  };
  vi.mocked(createGameRenderer).mockResolvedValue(renderer);
});

// Construction is async now -- unit models load before the renderer exists --
// so anything touching `renderer` or `clickTile` has to let that promise settle
// first. Rendering through one helper keeps every test on the same footing.
async function renderCanvas(server: GameServer, connection: ConnectionStatus = 'connected') {
  const result = render(<GameCanvas server={server} connection={connection} />);
  await act(async () => {});
  return result;
}

const fakeServer = (over: Partial<GameServer> = {}): GameServer => ({
  getState: () => board,
  submit: vi.fn(async () => ({ ok: true as const, seq: 1, events: [], state: board })),
  subscribe: vi.fn((onUpdate) => {
    onUpdate([], board);
    return () => {};
  }),
  dispose: vi.fn(),
  ...over,
});

describe('GameCanvas', () => {
  it('names whose turn it is', async () => {
    await renderCanvas(fakeServer());
    expect(screen.getByText(/Blue Army's turn/)).toBeTruthy();
  });

  it('shows the reconnecting banner only while retrying', async () => {
    const { rerender } = await renderCanvas(fakeServer());
    expect(screen.queryByText(/reconnecting/)).toBeNull();

    rerender(<GameCanvas server={fakeServer()} connection="retrying" />);
    expect(screen.getByText(/reconnecting/)).toBeTruthy();
  });

  it('shows the server reason when a command is refused', async () => {
    const server = fakeServer({
      submit: vi.fn(async () => ({ ok: false as const, reason: 'that unit has already acted' })),
    });
    await renderCanvas(server);

    fireEvent.click(screen.getByRole('button', { name: 'End Turn' }));
    expect(await screen.findByText(/that unit has already acted/)).toBeTruthy();
  });

  it('submits an endTurn when the button is pressed', async () => {
    const server = fakeServer();
    await renderCanvas(server);
    fireEvent.click(screen.getByRole('button', { name: 'End Turn' }));
    expect(server.submit).toHaveBeenCalledWith({ type: 'endTurn' });
  });

  // The renderer is built once for a canvas and torn down with it; leaving it
  // alive would keep a WebGL context and a render loop running per navigation.
  it('builds a renderer on mount and disposes it on unmount', async () => {
    const { unmount } = await renderCanvas(fakeServer());
    expect(createGameRenderer).toHaveBeenCalledTimes(1);
    unmount();
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
  });

  // The mirror of MatchRoute's late-connect case: models load asynchronously,
  // so a canvas can unmount while its renderer is still being built. The
  // renderer that arrives afterwards has to be disposed rather than stored, or
  // its engine keeps rendering into a canvas nobody is showing.
  it('disposes a renderer that finishes building after unmount', async () => {
    const { unmount } = render(<GameCanvas server={fakeServer()} connection="connected" />);
    unmount();
    expect(renderer.dispose).not.toHaveBeenCalled();

    await act(async () => {}); // the build resolves now, into a dead component
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(renderer.onTileClick).not.toHaveBeenCalled();
  });

  // The click handler is registered with the renderer, so a tile click has to
  // reach the session through it rather than through any React event.
  // The renderer ref is nulled on unmount, and that is load-bearing rather than
  // tidiness: a queue task parked on an animation resolves after teardown and
  // then calls onSnap, which would otherwise reach a disposed scene.
  it('does not touch a disposed renderer when a batch lands after unmount', async () => {
    let push!: (events: GameEvent[], state: GameState) => void;
    const server = fakeServer({
      subscribe: vi.fn((onUpdate) => {
        push = onUpdate;
        return () => {};
      }),
    });
    const { unmount } = await renderCanvas(server);

    let finish!: () => void;
    vi.mocked(renderer.playEvents).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );

    const moved: GameEvent = {
      type: 'unitMoved',
      unitId: 'b1',
      facing: 'north',
      path: [
        { col: 1, row: 1 },
        { col: 1, row: 2 },
      ],
    };
    await act(async () => push([moved], board)); // the task parks on playEvents
    unmount();
    vi.mocked(renderer.syncUnits).mockClear();

    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(renderer.syncUnits).not.toHaveBeenCalled();
  });

  it('routes a tile click into a selection push', async () => {
    await renderCanvas(fakeServer());
    expect(renderer.onTileClick).toHaveBeenCalled();

    // Selection is React state now, so the projection lands on the effect that
    // follows the commit rather than inside the click.
    await act(async () => clickTile({ col: 1, row: 1 })); // the unit's own tile
    expect(renderer.setSelectedTile).toHaveBeenLastCalledWith({ col: 1, row: 1 });
    // ⚠️ Tiles, not the search. The renderer used to be handed the whole
    // `Movement` so it could answer hover itself; it is given what to light.
    expect(vi.mocked(renderer.setRange).mock.lastCall?.[0].length).toBeGreaterThan(0);
  });

  // The point of registering a stable wrapper: clickTile's identity changes
  // with every selection, and the renderer must not be torn down and rebuilt
  // each time one does.
  it('does not rebuild the renderer when the selection changes', async () => {
    await renderCanvas(fakeServer());
    await act(async () => clickTile({ col: 1, row: 1 }));
    await act(async () => clickTile({ col: 1, row: 1 }));
    await act(async () => clickTile({ col: 1, row: 1 }));

    expect(createGameRenderer).toHaveBeenCalledTimes(1);
    expect(renderer.dispose).not.toHaveBeenCalled();
  });

  // ⚠️ The first click on a destination draws a route and moves nothing. That
  // is the whole point of the step: a route that is state renders the same on
  // a touchscreen, and the one computed under a pointer never did.
  it('pins a route without walking it, and keeps the unit highlighted', async () => {
    await renderCanvas(fakeServer());

    await act(async () => clickTile({ col: 1, row: 1 }));
    await act(async () => clickTile({ col: 1, row: 3 }));

    expect(renderer.previewMove).not.toHaveBeenCalled();
    expect(vi.mocked(renderer.setRoute).mock.lastCall?.[0]).toEqual([
      { col: 1, row: 1 },
      { col: 1, row: 2 },
      { col: 1, row: 3 },
    ]);
    // The unit has not moved, so the highlight must not claim it has -- and
    // the range stays up, because the pin can still be moved.
    expect(renderer.setSelectedTile).toHaveBeenLastCalledWith({ col: 1, row: 1 });
    expect(vi.mocked(renderer.setRange).mock.lastCall?.[0].length).toBeGreaterThan(0);
    expect(screen.getByText(/click again to confirm/i)).toBeTruthy();
  });

  // Every reachable tile stays live while a route is pinned, so changing your
  // mind costs one click rather than a cancel and a reselect.
  it('re-pins to another reachable tile without walking', async () => {
    await renderCanvas(fakeServer());

    await act(async () => clickTile({ col: 1, row: 1 }));
    await act(async () => clickTile({ col: 1, row: 3 }));
    await act(async () => clickTile({ col: 3, row: 1 }));

    expect(renderer.previewMove).not.toHaveBeenCalled();
    expect(vi.mocked(renderer.setRoute).mock.lastCall?.[0].at(-1)).toEqual({ col: 3, row: 1 });
  });

  // The menu is present but inert until the unit arrives: confirming mid-walk
  // would leave the mesh short of the destination, and the committed move
  // would then replay from wherever it had got to.
  // ⚠️ The menu is tiles now, so "shut" means unlit rather than disabled: an
  // inert lit tile invites a click that does nothing.
  it('holds the panel back until the confirmed unit arrives', async () => {
    let arrive!: () => void;
    vi.mocked(renderer.previewMove).mockReturnValue(
      new Promise<void>((resolve) => {
        arrive = resolve;
      }),
    );
    await renderCanvas(fakeServer());

    await act(async () => clickTile({ col: 1, row: 1 }));
    await act(async () => clickTile({ col: 1, row: 3 })); // pins
    await act(async () => clickTile({ col: 1, row: 3 })); // confirms

    expect(renderer.previewMove).toHaveBeenCalled();
    // Still walking: the range is the context, and no directions are offered.
    expect(renderer.setFacingChoices).toHaveBeenLastCalledWith([]);
    expect(vi.mocked(renderer.setRange).mock.lastCall?.[0].length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^Hold/ })).toBeNull();
    // And the pane is down, because it invites a click that is refused now.
    expect(screen.queryByText(/click again to confirm/i)).toBeNull();

    await act(async () => arrive());
    // ⚠️ The panel, and still nothing lit. Arrival offers a choice of
    // *questions*, not of tiles -- so the overlays stay clear until one is
    // picked, and the buttons are the only affordance.
    expect(screen.getByRole('button', { name: /^Hold/ })).toBeTruthy();
    // ⚠️ And no Fire, because this board has nobody to shoot. Omitted rather
    // than greyed, following AW -- a menu with no dead rows.
    expect(screen.queryByRole('button', { name: /^Fire/ })).toBeNull();
    expect(renderer.setFacingChoices).toHaveBeenLastCalledWith([]);
    expect(renderer.setAttackRange).toHaveBeenLastCalledWith([]);
    expect(renderer.setRange).toHaveBeenLastCalledWith([]);
    expect(renderer.setRoute).toHaveBeenLastCalledWith([]);

    // ⚠️ The four tiles themselves, not the centre they surround, and only once
    // Hold is chosen. The renderer used to derive them, which hid the clipping
    // rule somewhere untestable.
    await act(async () => screen.getByRole('button', { name: /^Hold/ }).click());
    expect(renderer.setFacingChoices).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        { col: 1, row: 4 },
        { col: 1, row: 2 },
        { col: 2, row: 3 },
        { col: 0, row: 3 },
      ]),
    );
    // And firing's band is dark, because exactly one mode is live.
    expect(renderer.setAttackRange).toHaveBeenLastCalledWith([]);
  });

  // ⚠️ The other half of omitting: the row appears the moment there is anything
  // to shoot. Both sides are asserted because a menu that never offers Fire and
  // a menu that always does are equally wrong and look the same from one test.
  it('offers Fire once something is in range, and not before', async () => {
    const contested = makeState(5, [
      { id: 'b1', col: 1, row: 1 },
      { id: 'r1', col: 1, row: 3, owner: 'red' },
    ]);
    await renderCanvas(
      fakeServer({
        getState: () => contested,
        subscribe: vi.fn((onUpdate) => {
          onUpdate([], contested);
          return () => {};
        }),
      }),
    );

    await act(async () => clickTile({ col: 1, row: 1 }));
    await act(async () => clickTile({ col: 1, row: 2 })); // pins
    await act(async () => clickTile({ col: 1, row: 2 })); // confirms
    expect(screen.getByRole('button', { name: /^Fire/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Hold/ })).toBeTruthy();
  });

  it('clears the overlays when the selection is dropped', async () => {
    await renderCanvas(fakeServer());
    await act(async () => clickTile({ col: 1, row: 1 })); // select
    await act(async () => clickTile({ col: 4, row: 4 })); // dead click, out of range
    expect(renderer.setSelectedTile).toHaveBeenLastCalledWith(null);
    expect(renderer.setRange).toHaveBeenLastCalledWith([]);
    expect(renderer.setRoute).toHaveBeenLastCalledWith([]);
  });

  // The menu is DOM like every other control -- the canvas draws the game and
  // nothing else -- so it is here rather than in the renderer.
  // ⚠️ No buttons left for a pinned destination at all -- every answer is a
  // tile. End Turn is the only thing the pin still reaches into the DOM for.
  it('locks End Turn while a destination is pinned, and frees it on cancel', async () => {
    await renderCanvas(fakeServer());
    expect(screen.getByRole('button', { name: 'End Turn' })).toHaveProperty('disabled', false);

    await act(async () => clickTile({ col: 1, row: 1 })); // select
    await act(async () => clickTile({ col: 1, row: 3 })); // pin
    expect(screen.getByRole('button', { name: 'End Turn' })).toHaveProperty('disabled', true);

    await act(async () => clickTile({ col: 3, row: 3 })); // neither: back out
    expect(screen.getByRole('button', { name: 'End Turn' })).toHaveProperty('disabled', false);
  });

  // ⚠️ **Nothing is ever silent and nothing ever describes another mode's
  // clicks.** The pane belongs to movement selection, the panel's buttons to
  // the moment of choosing, and one hint line to each mode after that. They
  // hand over rather than overlap, which is the property worth pinning: a lit
  // board with no explanation, or an explanation of a click that is not
  // available, are the two ways this goes wrong.
  it('hands the pane to the panel, and the panel to a per-mode hint', async () => {
    await renderCanvas(fakeServer());
    await act(async () => clickTile({ col: 1, row: 1 }));
    expect(screen.queryByText(/click again to confirm/i)).toBeNull();

    await act(async () => clickTile({ col: 1, row: 3 })); // pins
    expect(screen.getByText(/click again to confirm/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Hold/ })).toBeNull();

    await act(async () => clickTile({ col: 1, row: 3 })); // confirms
    expect(screen.getByRole('button', { name: /^Hold/ })).toBeTruthy();
    expect(screen.queryByText(/click again to confirm/i)).toBeNull();
    // ⚠️ No hint yet: at the panel there is nothing to say about tiles, because
    // no tile does anything.
    expect(screen.queryByText(/click a tile beside the unit/i)).toBeNull();

    await act(async () => screen.getByRole('button', { name: /^Hold/ }).click());
    expect(screen.getByText(/click a tile beside the unit/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Hold/ })).toBeNull();
  });
});
