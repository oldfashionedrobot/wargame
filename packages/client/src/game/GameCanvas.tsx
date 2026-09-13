import { useCallback, useEffect, useRef } from 'react';
import { getCurrentPlayer } from '@vod/shared';
import type { Coordinate, GameEvent, GameServer, GameState } from '@vod/shared';
import { useGameSession } from './useGameSession';
import { facingChoiceOrigin } from './interaction/selection';
import type { SelectionState } from './interaction/selection';
import type { ConnectionStatus } from '../net/gameServer';
import { createGameRenderer } from './render/renderer';
import type { GameRenderer } from './render/renderer';

// Pushes a selection to the renderer. Module-level so there's one place that
// knows how a selection is displayed -- attacking adds a third overlay here.
// A pure projection of the selection: everything it draws is on the snapshot,
// so there is no game state to fetch and no question of which copy to read.
// ⚠️ A projection of the selection *and* whether the preview is still walking.
// It used to be the selection alone; the menu now lights on arrival, so what is
// drawn depends on both. Still pure, and still no game state fetched.
function showSelection(renderer: GameRenderer, selection: SelectionState, walking: boolean): void {
  const pinned = selection.phase === 'destinationChosen';
  // The tiles around the unit *are* the menu, and they wait for it to arrive:
  // an inert lit tile invites a click that does nothing.
  const arrived = pinned && !walking;

  renderer.setFacingChoices(arrived ? facingChoiceOrigin(selection) : null);

  const highlight =
    selection.phase === 'unitSelected'
      ? selection.position
      : selection.phase === 'idle'
        ? null
        : selection.path[selection.path.length - 1];

  renderer.setSelectedTile(highlight);
  // The range stays lit while the unit walks -- it is the context the choice
  // was made against -- and comes down as the menu lights, so the handover
  // reads as one moment rather than as a gap.
  renderer.setMovement(
    selection.phase === 'unitSelected' || (pinned && walking) ? selection.movement : null,
  );
}

export interface GameCanvasProps {
  server: GameServer;
  connection: ConnectionStatus;
}

// The canvas half: a canvas ref, the renderer lifecycle, and how to draw a
// selection. Everything else about playing a match lives in useGameSession.
export function GameCanvas({ server, connection }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GameRenderer | null>(null);

  // Both callbacks read the ref at call time, never capture the renderer: a
  // queue task parked on an animation resolves after this canvas unmounted, and
  // must find null rather than a disposed renderer. Tested by mutation.
  const onEvents = useCallback(
    (events: GameEvent[]): Promise<void> =>
      rendererRef.current?.playEvents(events) ?? Promise.resolve(),
    [],
  );

  const onSnap = useCallback((state: GameState): void => {
    rendererRef.current?.snapUnits(state);
  }, []);

  const onPreview = useCallback(
    (next: { unitId: string; path: Coordinate[] } | null): Promise<void> => {
      const renderer = rendererRef.current;
      if (!renderer) return Promise.resolve();
      if (!next) {
        renderer.cancelPreview();
        return Promise.resolve();
      }
      return renderer.previewMove(next.unitId, next.path);
    },
    [],
  );

  const { gameState, rejection, selection, walking, clickTile, cancelDestination, endTurn } =
    useGameSession(server, { onEvents, onSnap, onPreview });

  // The menu waits for the unit to arrive -- committing mid-walk would leave
  // the mesh short of the destination, and the move would then replay from
  // wherever it had got to.
  const pinned = selection.phase === 'destinationChosen';

  // `clickTile` changes identity whenever the selection does, and the renderer
  // is registered with it exactly once. A stable wrapper over a latest-ref
  // keeps the registered function fixed, so a click never rebuilds the scene.
  // Splitting registration into its own effect does not work: construction is
  // async, so that effect would run while the ref is still null and nothing
  // would re-run it when the renderer arrives.
  const clickTileRef = useRef(clickTile);
  useEffect(() => {
    clickTileRef.current = clickTile;
  });

  // Construction is async because unit models are loaded before any unit
  // exists, so this carries the same teardown race MatchRoute's connect does:
  // a renderer that finishes building after unmount has to be disposed rather
  // than stored, or its engine keeps running against a detached canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;

    void createGameRenderer(canvas, server.getState()).then((renderer) => {
      if (disposed) {
        renderer.dispose();
        return;
      }
      rendererRef.current = renderer;
      renderer.onTileClick((coordinate) => clickTileRef.current(coordinate));
    });

    return () => {
      disposed = true;
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [server]);

  // Selection reaches the renderer as a projection of state rather than a
  // callback, which is what lets the hook stop knowing anything about it.
  // Nothing to draw before the renderer exists: a selection can only come from
  // a click, and clicks arrive through the renderer.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer) showSelection(renderer, selection, walking);
  }, [selection, walking]);

  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{ width: '100vw', height: '90vh', display: 'block', touchAction: 'none' }}
      />
      <div>
        <span>{getCurrentPlayer(gameState).name}&apos;s turn</span>{' '}
        {/* Disabled while a destination is pinned: ending the turn there would
            submit around a plan the player has not answered for yet. */}
        <button type="button" onClick={endTurn} disabled={pinned}>
          End Turn
        </button>{' '}
        {import.meta.env.DEV && (
          <button type="button" onClick={() => rendererRef.current?.toggleInspector()}>
            Toggle Inspector
          </button>
        )}
        {pinned && (
          <>
            {/* The only thing left telling a player what a click means, now
                that Wait is a tile rather than a button. */}
            {!walking && <span>Click the unit to wait, or a tile beside it to face that way.</span>}{' '}
            <button type="button" onClick={cancelDestination} disabled={walking}>
              Cancel
            </button>{' '}
          </>
        )}
        {rejection && <span style={{ color: '#c0392b' }}> rejected: {rejection}</span>}
        {connection === 'retrying' && <span style={{ color: '#b9770e' }}> reconnecting…</span>}
      </div>
    </div>
  );
}
