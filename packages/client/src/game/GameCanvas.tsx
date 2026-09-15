import { useCallback, useEffect, useRef } from 'react';
import { getCurrentPlayer, isOver } from '@vod/shared';
import type { Coordinate, GameEvent, GameServer, GameState } from '@vod/shared';
import { useGameSession } from './useGameSession';
import { attackForecast, isAiming, isPlan, destinationOf } from './interaction/selection';
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
  // ⚠️ **Exactly one set is lit, and the mode is what guarantees it.** These
  // were two independent conditions that merely happened never to be true at
  // once; now the step says which tiles mean something, so the other overlay
  // clears because there is nothing else it could be showing.
  const step = arrived ? selection.step : null;
  renderer.setFacingChoices(step?.kind === 'holding' ? step.tiles : []);
  renderer.setAttackRange(step?.kind === 'firing' ? step.tiles : []);

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
  const menuRef = useRef<HTMLDivElement>(null);

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

  const { gameState, rejection, selection, walking, clickTile, chooseAction, endTurn } =
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

  // ⚠️ **Two questions, and the rule is the first one.** `isOver` decides whether
  // the game is finished; the lookup only decides what to *call* the winner. Key
  // the rule off the lookup instead and a `winner` naming somebody outside
  // `players` would leave the board showing a live turn label and an enabled
  // button for a finished game -- unreachable today, since `soleSurvivor` picks
  // from `players`, and exactly the sort of thing that stops being unreachable
  // quietly.
  //
  // The name is resolved because the board has always named players by their
  // display name; the lobby shows the raw id, having no roster to resolve
  // against.
  const over = isOver(gameState);
  const winner = gameState.players.find((player) => player.id === gameState.winner);

  // ⚠️ Only while the route is still a plan, and not while it is being walked:
  // the pane invites a click, and clicks are refused until the mesh arrives.
  const awaitingConfirm = selection.phase === 'routePinned' && !walking;

  // The panel is the same DOM-over-canvas trick as the confirm pane, anchored
  // over the target instead of the destination. Only one is ever up, which is
  // why `anchorTo` taking a single element is enough.
  // The panel is up when the unit has arrived and has not yet been told what
  // to do. It is the only affordance in that moment: no tile is lit.
  const menuOpen = selection.phase === 'destinationChosen' && selection.step.kind === 'choosing';
  const aiming = isAiming(selection) ? selection : null;
  const forecast = aiming ? attackForecast(server.getState(), aiming) : null;

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
    // ⚠️ Three things can be anchored now and `anchorTo` still takes one
    // element, because still only one is ever up: the forecast over a pinned
    // target, the menu over the destination, the confirm pane over a route that
    // has not walked. The modes are what make that exclusive.
    if (aiming) {
      renderer.anchorTo(attackPanelRef.current, aiming.step.target.position);
      return;
    }
    if (menuOpen) {
      renderer.anchorTo(menuRef.current, destinationOf(selection));
      return;
    }
    renderer.anchorTo(
      awaitingConfirm ? confirmPaneRef.current : null,
      awaitingConfirm ? destinationOf(selection) : null,
    );
  }, [awaitingConfirm, aiming, menuOpen, selection]);

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
        {menuOpen && (
          <div
            ref={menuRef}
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
            <button type="button" onClick={() => chooseAction('firing')}>
              Fire
            </button>
            <button type="button" onClick={() => chooseAction('holding')}>
              Hold — face them, do not fire
            </button>
          </div>
        )}

        {aiming && forecast && (
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
            {/* ⚠️ Informational, with no button, like the route's confirm pane
                -- and for the same reason. Buttons pick intent; tiles pick
                targets. A second click on the target is what fires, which is the
                gesture the route already taught. */}
            <span>
              Fire — {forecast.low}
              {forecast.high > forecast.low && `–${forecast.high}`} damage
              {forecast.answered && ' · they return fire'}
            </span>
            <span style={{ opacity: 0.75 }}>Click again to confirm</span>
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
        {over ? (
          <strong>{winner ? `${winner.name} wins` : 'game over'}</strong>
        ) : (
          <span>{getCurrentPlayer(gameState).name}&apos;s turn</span>
        )}{' '}
        {/* Disabled while anything is pinned: ending the turn there would
            submit around a plan the player has not answered for yet. And once
            the game is over: the server refuses every command, so an enabled
            button would only ever produce a rejection. */}
        <button type="button" onClick={endTurn} disabled={planning || over}>
          End Turn
        </button>{' '}
        {import.meta.env.DEV && (
          <button type="button" onClick={() => rendererRef.current?.toggleInspector()}>
            Toggle Inspector
          </button>
        )}
        {/* ⚠️ One line per mode, because a mode is exactly one question. The
            combined sentence this replaced had to describe three readings of a
            tile click at once, which is the thing the panel exists to stop. */}
        {selection.phase === 'destinationChosen' && selection.step.kind !== 'choosing' && (
          <span>
            {selection.step.kind === 'firing'
              ? 'Click an enemy in range, then click it again to fire. Click elsewhere to go back.'
              : 'Click a tile beside the unit to face that way, or the unit to keep its facing.'}
          </span>
        )}
        {rejection && <span style={{ color: '#c0392b' }}> rejected: {rejection}</span>}
        {connection === 'retrying' && <span style={{ color: '#b9770e' }}> reconnecting…</span>}
      </div>
    </div>
  );
}
