import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { getCurrentPlayer, isOver } from '@vod/shared';
import type { Coordinate, GameEvent, GameServer, GameState } from '@vod/shared';
import { useGameSession } from './useGameSession';
import {
  attackForecast,
  availableActions,
  isAiming,
  isPlan,
  destinationOf,
} from './interaction/selection';
import type { ActionKind, MenuStep, Pinned, SelectionState } from './interaction/selection';
import type { ConnectionStatus } from '../net/gameServer';
import { PLAYER_HEX } from './render/playerColors';
import { createGameRenderer } from './render/renderer';
import type {
  CutawayScene,
  CutawaySide as CutawaySideData,
  GameRenderer,
  StepOverlay,
} from './render/renderer';

// Pushes a selection to the renderer. Module-level so there's one place that
// knows how a selection is displayed -- attacking adds a third overlay here.
// A pure projection of the selection: everything it draws is on the snapshot,
// so there is no game state to fetch and no question of which copy to read.
// ⚠️ Takes `walking` as well as the selection, and has to: the route comes down
// on *confirm* rather than on arrival, so the walk is a visible state of its own
// that no phase records. Still pure, and still no game state fetched.
/**
 * What each step means to the board and to the reader: which overlay it lights,
 * and what the line under the canvas says while it is up.
 *
 * ⚠️ **One table, where this was four branches on the same discriminant.** The
 * three overlay setters each re-tested `step.kind`, and the hint line tested it
 * again in a nested ternary somewhere else entirely -- so "what a step means"
 * was knowledge a reader had to gather from four places and an author had to
 * remember to update in all of them. `Record<MenuStep['kind'], …>` also makes a
 * new step a compile error here rather than a step that silently lights nothing
 * and says nothing.
 *
 * ⚠️ At `choosing` *nothing* is lit, and that is deliberate rather than a gap:
 * the buttons are the whole affordance there, so a lit tile would promise a
 * choice that is not being offered yet. "Lit does something" survives by
 * nothing being lit.
 */
const STEP_UI: Record<MenuStep['kind'], { overlay: StepOverlay | null; hint: string | null }> = {
  choosing: { overlay: null, hint: null },
  holding: {
    overlay: 'facing',
    hint: 'Click a tile beside the unit to face that way, or the unit to keep its facing.',
  },
  firing: {
    overlay: 'attack',
    hint: 'Click an enemy in range, then click it again to fire. Click elsewhere to go back.',
  },
  charging: {
    overlay: 'charge',
    hint: 'Click an enemy beside the unit, then click again to charge. Click elsewhere to go back.',
  },
};

/**
 * Is a drawn route still waiting to be confirmed?
 *
 * ⚠️ **One place, because it was two.** The rule lived in `showSelection` and
 * again in the component, spelled slightly differently both times, and it
 * governs three separate things -- the route, the confirm pane, and whether the
 * board is still lit. ⚠️ The route and the pane are one affordance (both say
 * *confirm this*), so both come down the instant it is confirmed and the ghost
 * walks over a clean board rather than retracing a line it has been handed.
 */
function isAwaitingConfirm(selection: SelectionState, walking: boolean): selection is Pinned {
  return selection.phase === 'routePinned' && !walking;
}

function showSelection(renderer: GameRenderer, selection: SelectionState, walking: boolean): void {
  const pinned = selection.phase === 'routePinned';

  // ⚠️ **Exactly one set is lit, and one call is what guarantees it.** These
  // were three independent setters with the rule in a comment above them, so
  // every update had to remember to clear the other two.
  const step = selection.phase === 'destinationChosen' ? selection.step : null;
  renderer.setStepTiles(
    step ? STEP_UI[step.kind].overlay : null,
    step && 'tiles' in step ? step.tiles : [],
  );

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
  // the panel opens, so the handover reads as one moment rather than as a gap.
  //
  // ⚠️ `settled`, not `reachable`: the overlay is about *reach*, and a hole
  // punched in it where a friendly unit happens to stand reads as out of range
  // rather than as occupied. Not every lit tile is clickable, which is fine --
  // `handleTileClick` asks `reachable`, and a click on a friend selects it.
  const ranged = selection.phase === 'unitSelected' || pinned;
  renderer.setRange(ranged ? selection.movement.settled : []);
  renderer.setRoute(isAwaitingConfirm(selection, walking) ? selection.path : []);
}

/**
 * One combatant's readout, printed over its staged view.
 *
 * ⚠️ **A full bar showing the true health, with the number beside it**, not the
 * board's ten bands. The ring is banded because it is a *glanceable* element
 * where ten segments stop it over-promising precision the formula lacks; this is
 * a *focused* view where the exact figure is the point. ⚠️ The band lines are
 * still drawn on the bar, so the structure the formula reads stays visible
 * without the value being rounded to it.
 */
function CutawaySide({ side, align }: { side: CutawaySideData; align: 'left' | 'right' }) {
  // ⚠️ **Mounted at the before-value, moved to the after one frame later.** A
  // bar mounted straight at its destination has nothing to transition from and
  // simply appears there. ⚠️ The initial value comes from `useState` rather than
  // from an effect correcting it, which is why the caller keys this on the
  // battle: a component that persisted across battles would have to reset
  // synchronously inside an effect, and that is a cascading render.
  const [shown, setShown] = useState(side.before);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(side.after));
    return () => cancelAnimationFrame(frame);
  }, [side.after]);

  return (
    <div style={{ flex: 1, padding: '0 24px', textAlign: align, alignSelf: 'flex-end' }}>
      <div style={{ fontSize: '13px', opacity: 0.85, marginBottom: '4px' }}>
        {side.unitTypeId}
        {side.defense > 0 && ` · ${'★'.repeat(side.defense)}`}
      </div>
      <div
        style={{
          position: 'relative',
          height: '12px',
          borderRadius: '2px',
          background: 'rgba(0, 0, 0, 0.45)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${shown}%`,
            height: '100%',
            background: PLAYER_HEX[side.color],
            transition: 'width 700ms ease-out',
          }}
        />
        {/* The ten bands the damage formula actually reads, drawn over the bar. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'repeating-linear-gradient(to right, transparent 0 calc(10% - 1px), rgba(0,0,0,0.5) calc(10% - 1px) 10%)',
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          gap: '8px',
          justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
          fontVariantNumeric: 'tabular-nums',
          fontSize: '15px',
          marginTop: '4px',
        }}
      >
        <span>{shown}</span>
        {/* ⚠️ **Shown only once the bar starts falling, and only if it falls.**
            Tying it to the same value the bar animates means the number and the
            movement arrive together rather than the figure being announced
            before anything happens — and a side that took nothing never renders
            a `−0`, because `shown` never leaves `before`. */}
        {shown !== side.before && (
          <span style={{ color: '#ff9a8a' }}>−{side.before - side.after}</span>
        )}
      </div>
    </div>
  );
}

/**
 * One row of the action panel.
 *
 * ⚠️ Styled rather than left as a default button, because the panel is the
 * primary interaction now and not a confirm box. Hover is the only state it
 * needs: there is no disabled row, since an unavailable action is omitted.
 */
/** ⚠️ Beside the list rather than inside it: the words are presentation and the
    modes are not, so a renamed row cannot change what a click does. */
const ACTION_LABEL: Record<ActionKind, string> = {
  firing: 'Fire',
  charging: 'Charge',
  holding: 'Hold',
};

function MenuItem({ label, onClick }: { label: string; onClick: () => void }): ReactElement {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{
        appearance: 'none',
        border: 'none',
        borderRadius: '4px',
        padding: '6px 12px',
        font: 'inherit',
        fontSize: '13px',
        textAlign: 'left',
        cursor: 'pointer',
        color: '#f2f4f7',
        background: hovered ? 'rgba(255, 255, 255, 0.14)' : 'transparent',
      }}
    >
      {label}
    </button>
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
  // ⚠️ Three things can be anchored over a tile and only one is ever up, which
  // is why `anchorTo` taking a single element is still enough: the pane while a
  // route waits to be confirmed, the menu while the intent is being chosen, and
  // the forecast while a target is pinned. The modes are what make that true.
  const confirmPaneRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const forecastRef = useRef<HTMLDivElement>(null);

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
  const awaitingConfirm = isAwaitingConfirm(selection, walking);

  // The panel is the same DOM-over-canvas trick as the confirm pane, anchored
  // over the target instead of the destination. Only one is ever up, which is
  // why `anchorTo` taking a single element is enough.
  // The panel is up when the unit has arrived and has not yet been told what
  // to do. It is the only affordance in that moment: no tile is lit.
  // What the cutaway is showing, or null between battles. ⚠️ Pushed by the
  // renderer rather than derived here: the *before* healths live in what it last
  // drew, and nothing above it has them once the batch has been folded.
  const [cutaway, setCutaway] = useState<CutawayScene | null>(null);

  const menuOpen = selection.phase === 'destinationChosen' && selection.step.kind === 'choosing';
  // The same table the overlays come from, so a step's tiles and its
  // instruction cannot describe two different things.
  const hint = selection.phase === 'destinationChosen' ? STEP_UI[selection.step.kind].hint : null;
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
      renderer.onCutaway(setCutaway);
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
    if (aiming) {
      renderer.anchorTo(forecastRef.current, aiming.step.target.position);
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
        {/* ⚠️ **Full-canvas and it eats pointer events**, which is not decoration:
            a click during a cutaway is read against authoritative state the
            board is not yet showing, so it would act on a position the player
            cannot see. Swallowing it here costs one property and needs no flag
            threaded up from the renderer. */}
        {cutaway && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              color: '#f2f4f7',
              textShadow: '0 1px 3px rgba(0, 0, 0, 0.8)',
              pointerEvents: 'auto',
              cursor: 'pointer',
            }}
            // ⚠️ The whole overlay is the button, because the whole overlay is
            // what is in the way: it already swallows pointer events so a stray
            // click cannot reach the board, and anything smaller would leave
            // most of a click-to-continue view not accepting the click.
            onClick={() => rendererRef.current?.dismissCutaway()}
          >
            {/* ⚠️ Pinned to the band's own bottom edge rather than laid out in
                flow. The band is a *viewport* -- 30% to 70% measured from the
                bottom of the canvas, which is 30% to 70% from the top -- so the
                readout belongs at 70%, and a spacer only approximates it. */}
            <div
              style={{
                position: 'absolute',
                top: '60%',
                left: 0,
                right: 0,
                display: 'flex',
                alignItems: 'flex-end',
              }}
            >
              <CutawaySide key={`a${cutaway.id}`} side={cutaway.attacker} align="left" />
              <div
                style={{
                  fontSize: '13px',
                  opacity: 0.75,
                  paddingBottom: '18px',
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                }}
              >
                {cutaway.kind === 'charge' ? 'charge' : 'fire'}
                {/* ⚠️ Said, because a view that waits without saying so reads as
                    one that has hung. */}
                <div style={{ opacity: 0.7, marginTop: '2px' }}>click to continue</div>
              </div>
              <CutawaySide key={`d${cutaway.id}`} side={cutaway.defender} align="right" />
            </div>
          </div>
        )}

        {menuOpen && (
          <div
            ref={menuRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              marginTop: '-10px',
              padding: '4px',
              borderRadius: '6px',
              border: '1px solid rgba(255, 255, 255, 0.16)',
              background: 'rgba(18, 22, 28, 0.94)',
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.45)',
              minWidth: '104px',
              display: 'flex',
              flexDirection: 'column',
              gap: '1px',
            }}
          >
            {/* ⚠️ **Offered only when there is something to shoot**, following
                AW, which omits rather than greys. The cost is that "nothing is
                in range" and "I misread the menu" look the same; the gain is a
                menu with no dead rows, which is what makes it readable at a
                glance. Revisit if omitting reads badly in play.
                ⚠️ `canFire` asks `refuseAttack`, the same rule the click will,
                so the button and the tile cannot disagree. */}
            {/* ⚠️ Rendered from the same list the arrival path counts, so a row
                the panel offers and a row the skip believes in cannot differ.
                Each entry is there because the rule that will answer the click
                said so -- `canCharge` asks `refuseCharge` -- rather than because
                a tile set happened to be non-empty. */}
            {availableActions(gameState, selection).map((kind) => (
              <MenuItem key={kind} label={ACTION_LABEL[kind]} onClick={() => chooseAction(kind)} />
            ))}
          </div>
        )}

        {aiming && forecast && (
          <div
            ref={forecastRef}
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
            {forecast.kind === 'fire' ? (
              <span>
                Fire — {forecast.low}
                {forecast.high > forecast.low && `–${forecast.high}`} damage
                {forecast.answered && ' · they return fire'}
              </span>
            ) : (
              /* ⚠️ An exact figure where a shot gets a range, because no roll
                 enters `chance` -- and the cost of failing is the band, which is
                 the reverse of how a shot reads. */
              <span>
                Charge — {forecast.chance}% to break · {forecast.repelLow}
                {forecast.repelHigh > forecast.repelLow && `–${forecast.repelHigh}`} if it fails
              </span>
            )}
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
        {hint && <span>{hint}</span>}
        {rejection && <span style={{ color: '#c0392b' }}> rejected: {rejection}</span>}
        {connection === 'retrying' && <span style={{ color: '#b9770e' }}> reconnecting…</span>}
      </div>
    </div>
  );
}
