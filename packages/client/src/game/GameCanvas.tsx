import { useCallback, useEffect, useRef } from 'react';
import { getCurrentPlayer } from '@vod/shared';
import type { Coordinate, GameEvent, GameServer, GameState } from '@vod/shared';
import { useGameSession } from './useGameSession';
import {
  attackForecast,
  facingChoiceOrigin,
  isPlan,
  pinnedDestination,
} from './interaction/selection';
import type { SelectionState } from './interaction/selection';
import type { ConnectionStatus } from '../net/gameServer';
import { createGameRenderer } from './render/renderer';
import type { GameRenderer } from './render/renderer';

// Pushes a selection to the renderer. Module-level so there's one place that
// knows how a selection is displayed -- attacking adds a third overlay here.
// A pure projection of the selection: everything it draws is on the snapshot,
// so there is no game state to fetch and no question of which copy to read.
// ⚠️ Takes `walking` as well as the selection, and has to: the route comes down
// on *confirm* rather than on arrival, so the walk is a visible state of its own
// that no phase records. Still pure, and still no game state fetched.
function showSelection(renderer: GameRenderer, selection: SelectionState, walking: boolean): void {
  const arrived = selection.phase === 'destinationChosen';
  const pinned = selection.phase === 'routePinned';
  // ⚠️ While the panel is up the board goes quiet, and it needs no branch to do
  // it: `targetChosen` is neither `arrived` nor `pinned`, so every overlay below
  // clears on its own. That is the right outcome -- every tile click is a way
  // out of the panel, so lighting one would promise a choice that is not there,
  // and "lit does something" survives by nothing being lit.
  // ⚠️ The route and the pane are one affordance -- both say *confirm this* --
  // so both come down the instant it is confirmed, and the ghost walks over a
  // clean board rather than retracing a line it has already been handed.
  const awaitingConfirm = pinned && !walking;

  // The tiles around the unit *are* the menu, and only once it has walked: an
  // inert lit tile invites a click that does nothing.
  renderer.setFacingChoices(arrived ? facingChoiceOrigin(selection) : null);
  renderer.setAttackRange(arrived ? selection.attackTiles : []);

  // ⚠️ The unit's own tile, never the pin. A pinned route has not been walked,
  // so highlighting its destination would claim the unit is somewhere it is
  // not; the route and the pane are what mark where it *would* go. Once it
  // arrives, its own tile is the destination and this needs no special case.
  const highlight =
    selection.phase === 'idle'
      ? null
      : selection.phase === 'unitSelected'
        ? selection.position
        : selection.path[pinned ? 0 : selection.path.length - 1];

  renderer.setSelectedTile(highlight);
  // The range stays lit for as long as the pin can still move -- which includes
  // the walk, since the phase only turns over on arrival -- and comes down as
  // the menu lights, so the handover reads as one moment rather than as a gap.
  //
  // ⚠️ `settled`, not `reachable`: the overlay is about *reach*, and a hole
  // punched in it where a friendly unit happens to stand reads as out of range
  // rather than as occupied. Not every lit tile is clickable, which is fine --
  // `handleTileClick` asks `reachable`, and a click on a friend selects it.
  const ranged = selection.phase === 'unitSelected' || pinned;
  renderer.setRange(ranged ? selection.movement.settled : []);
  renderer.setRoute(awaitingConfirm ? selection.path : []);
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
  const confirmPaneRef = useRef<HTMLDivElement>(null);
  const attackPanelRef = useRef<HTMLDivElement>(null);

  // Both callbacks read the ref at call time, never capture the renderer: a
  // queue task parked on an animation resolves after this canvas unmounted, and
  // must find null rather than a disposed renderer. Tested by mutation.
  const onEvents = useCallback(
    (events: GameEvent[]): Promise<void> =>
      rendererRef.current?.playEvents(events) ?? Promise.resolve(),
    [],
  );

  const onSnap = useCallback((state: GameState): void => {
    rendererRef.current?.syncUnits(state);
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

  const { gameState, rejection, selection, walking, clickTile, commitAttack, endTurn } =
    useGameSession(server, {
      onEvents,
      onSnap,
      onPreview,
    });

  // Either kind of plan: a route drawn, or a unit standing at the end of one.
  // Both are uncommitted, and End Turn has no business submitting around them.
  // Every kind of uncommitted plan, asked rather than listed -- a fourth phase
  // would otherwise have to be remembered here too.
  const planning = isPlan(selection);

  // ⚠️ Looked up rather than shown raw. `winner` is a `PlayerId`, and the board
  // has always named players by their display name -- the lobby shows the id
  // because it has no roster to resolve it against, and this does.
  const winner = gameState.players.find((player) => player.id === gameState.winner);

  // ⚠️ Only while the route is still a plan, and not while it is being walked:
  // the pane invites a click, and clicks are refused until the mesh arrives.
  const awaitingConfirm = selection.phase === 'routePinned' && !walking;

  // The panel is the same DOM-over-canvas trick as the confirm pane, anchored
  // over the target instead of the destination. Only one is ever up, which is
  // why `anchorTo` taking a single element is enough.
  const choosing = selection.phase === 'targetChosen' ? selection : null;
  const forecast = choosing ? attackForecast(server.getState(), choosing) : null;

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

  // The pane rides the board rather than the page: React writes what it says,
  // the renderer writes where it is. Cleared by the same call that sets it, so
  // an unpinned plan never leaves an element tracking a tile nobody chose.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (choosing) {
      renderer.anchorTo(attackPanelRef.current, choosing.target.position);
      return;
    }
    renderer.anchorTo(
      awaitingConfirm ? confirmPaneRef.current : null,
      awaitingConfirm ? pinnedDestination(selection) : null,
    );
  }, [awaitingConfirm, choosing, selection]);

  return (
    <div>
      {/* Positioned so the confirm pane has an origin to be offset from -- the
          renderer projects into the canvas's own pixel space. ⚠️ `overflow`
          because `Vector3.Project` does not clip: a pinned tile that zoom has
          pushed off screen projects outside this box, and an absolute child
          out there would add page scrollbars. */}
      <div style={{ position: 'relative', width: '100vw', height: '90vh', overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
        />
        {/* Mounted only while it applies. ⚠️ React populates refs during the
            commit, *before* effects run, so the anchor effect below still finds
            this element on the render that introduces it -- and finds null on
            the one that removes it, which is exactly the clear.
            `pointerEvents: none` because the tile underneath is the button: a
            pane that swallowed the click would block its own confirmation. */}
        {/* ⚠️ The panel, and the one place in the game with real buttons. Every
            other answer is a tile, which is why `clickTile` and `endTurn` were
            the only verbs until now -- a preview with numbers in it cannot be a
            tile, and Hold cannot be one either, since the only tile that faces
            an enemy is the one they are standing on. */}
        {choosing && forecast && (
          <div
            ref={attackPanelRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              marginTop: '-14px',
              padding: '6px 8px',
              borderRadius: '5px',
              background: 'rgba(24, 28, 34, 0.92)',
              color: '#f2f4f7',
              fontSize: '13px',
              lineHeight: 1.5,
              whiteSpace: 'nowrap',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              alignItems: 'stretch',
            }}
          >
            <button type="button" onClick={() => commitAttack(true)}>
              Fire — {forecast.low}
              {forecast.high > forecast.low && `–${forecast.high}`} damage
              {forecast.answered && ' · they return fire'}
            </button>
            <button type="button" onClick={() => commitAttack(false)}>
              Hold — face them, do not fire
            </button>
          </div>
        )}

        {awaitingConfirm && (
          <div
            ref={confirmPaneRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              padding: '4px 10px',
              marginTop: '-12px',
              borderRadius: '4px',
              background: 'rgba(24, 28, 34, 0.88)',
              color: '#f2f4f7',
              fontSize: '13px',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
            Click again to confirm
          </div>
        )}
      </div>
      <div>
        {/* ⚠️ The winner is checked first and `getCurrentPlayer` is not called
            at all once there is one -- it throws when `currentTurn` names
            nobody, and this runs every render. Today `currentTurn` is never
            cleared so both would work; the ordering is what keeps that from
            being load-bearing. */}
        {winner ? (
          <strong>{winner.name} wins</strong>
        ) : (
          <span>{getCurrentPlayer(gameState).name}&apos;s turn</span>
        )}{' '}
        {/* Disabled while anything is pinned: ending the turn there would
            submit around a plan the player has not answered for yet. And once
            the game is over: the server refuses every command, so an enabled
            button would only ever produce a rejection. */}
        <button type="button" onClick={endTurn} disabled={planning || winner !== undefined}>
          End Turn
        </button>{' '}
        {import.meta.env.DEV && (
          <button type="button" onClick={() => rendererRef.current?.toggleInspector()}>
            Toggle Inspector
          </button>
        )}
        {/* The only thing telling a player what a click means, now that every
            answer to a pinned destination is a tile rather than a button. The
            pane carries the other half, while the route is still a plan. */}
        {selection.phase === 'destinationChosen' && (
          <span>
            Click an enemy in range to attack, the unit to hold, a tile beside it to face that way,
            or elsewhere to cancel.
          </span>
        )}
        {rejection && <span style={{ color: '#c0392b' }}> rejected: {rejection}</span>}
        {connection === 'retrying' && <span style={{ color: '#b9770e' }}> reconnecting…</span>}
      </div>
    </div>
  );
}
