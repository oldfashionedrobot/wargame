import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Command,
  CommandResult,
  Coordinate,
  GameEvent,
  GameServer,
  GameState,
} from '@vod/shared';
import { coordinatesEqual, isOver } from '@vod/shared';
import {
  enterMode,
  chooseTarget,
  clearStep,
  confirmRoute,
  handleTileClick,
  initialSelectionState,
  isAiming,
  isAim,
  isPlan,
  facingForTarget,
  moveCommandFor,
  destinationOf,
  readAimClick,
  readHoldClick,
  unpinDestination,
} from './interaction/selection';
import type { SelectionState } from './interaction/selection';

// The session half of what GameCanvas used to own -- everything about playing
// a match that is not Babylon: the render replica, the rejection, the
// in-flight guard, the selection, and the submits. The canvas half stays a
// consumer: it supplies the two callbacks and never hands the hook a renderer,
// so the hook never learns what Babylon is.

export interface GameSessionCallbacks {
  /**
   * The authority decided these happened -- animate them, in order. The
   * state they produced commits only once the returned promise settles.
   */
  onEvents: (events: GameEvent[]) => Promise<void>;
  /**
   * Position the display from state, no tween. Runs on every batch before
   * its commit: a visual no-op after a played animation, the correction
   * after a skipped or failed one.
   */
  onSnap: (state: GameState) => void;
  /**
   * Walk a unit to a destination it has not committed to, or `null` to put it
   * back. Resolves when the preview settles -- which is arrival, but also a
   * cancel or an authoritative snap ending it early.
   *
   * Deliberately *not* called on confirm, nor when an incoming update drops a
   * pin: both end with `onSnap` writing authoritative positions over the mesh,
   * so the correction the display already performs is the instruction. That is
   * why there is no commit half to this.
   */
  onPreview: (next: { unitId: string; path: Coordinate[] } | null) => Promise<void>;
}

// Animate small live batches; snap everything else. The cap separates "a
// dropped poll" from "gone a while" -- these are chess-length games, and
// catch-up replay at tween speed is worse than useless. Hidden tabs skip
// too: browsers throttle rAF there, so an awaited animation would stall the
// queue rather than play.
//
// Counted in tiles rather than events, because that is what costs time: a
// move animates per step, so ten long moves is far more waiting than ten
// short ones. At 0.15s a tile this is a bit over four seconds -- the ceiling
// is the wait, so it moved when the pace did.
const MAX_ANIMATED_TILES = 28;

function animatedTiles(events: GameEvent[]): number {
  return events.reduce(
    (total, event) => total + (event.type === 'unitMoved' ? event.path.length - 1 : 0),
    0,
  );
}

function worthAnimating(events: GameEvent[]): boolean {
  if (events.length === 0 || document.hidden) return false;
  const tiles = animatedTiles(events);
  // Nothing to watch (an end-turn on its own) still counts as worth playing:
  // the queue is what orders the state commit, and skipping it there would
  // commit early rather than save time.
  return tiles <= MAX_ANIMATED_TILES;
}

export interface GameSession {
  /**
   * Render replica of the server's state, fed by subscribe(). Display only --
   * anything needing the authoritative value reads server.getState() instead
   * (invariant 1); a second copy would only be a second thing to desync.
   * Lags deliberately while a batch animates: it commits only after the
   * events that produced it have been shown.
   */
  gameState: GameState;
  /** Why the last command was refused; cleared by the next server update. */
  rejection: string | null;
  /**
   * What is selected, and the movement snapshot taken when it was. React state
   * rather than a ref: the confirmation menu renders off it, and a second copy
   * held for callbacks is a second thing that can be wrong.
   */
  selection: SelectionState;
  /**
   * The previewed unit is still walking to its pinned destination. The whole
   * UI is inert until it arrives -- which is what lets a confirmed move skip
   * re-animating, since the mesh is by then exactly where the event ends.
   */
  walking: boolean;
  /** Every click on the board, in every phase. */
  clickTile: (coordinate: Coordinate) => void;
  /**
   * The panel's answer: enter a mode, which lights the tiles that answer for it.
   *
   * ⚠️ **The only thing a button calls.** Everything else a player does is a
   * tile click -- buttons pick the intent, tiles pick the target -- which is
   * what stops a new action from being another reading a click has to be
   * disambiguated against.
   */
  chooseAction: (kind: 'firing' | 'charging' | 'holding') => void;
  /** End the turn outright, without committing whatever is being planned. */
  endTurn: () => void;
}

export function useGameSession(server: GameServer, callbacks: GameSessionCallbacks): GameSession {
  const [gameState, setGameState] = useState<GameState>(() => server.getState());
  const [rejection, setRejection] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionState>(initialSelectionState);
  const [walking, setWalking] = useState(false);
  // A command is a round trip, so a second click can land before the first
  // resolves. Both would read the same state and submit against it; the
  // server rejects the loser, but the UI would already have moved on.
  const pendingRef = useRef(false);

  // Latest-ref, so the subscription below depends only on `server`. If the
  // callbacks sat in its dependency array, any identity change would re-run
  // it -- and subscribe fires synchronously with a setRejection(null), so a
  // re-run per render would wipe a rejection before anyone saw it.
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  /**
   * Submits a command and moves the selection optimistically, rolling the
   * selection back if the authority refuses.
   *
   * Optimistic here means the *UI affordance* only -- game state still comes
   * exclusively from the server. Clearing the selection instantly is what
   * keeps a click feeling immediate over a network; restoring it on rejection
   * is what stops a refused action from looking like it happened.
   */
  const submitCommand = useCallback(
    async (
      command: Command,
      nextSelection: SelectionState,
      // What to show if the authority refuses. Defaults to what was on screen,
      // which is right for End Turn; a refused move overrides it, because
      // handing back a pinned destination the server just rejected invites the
      // player to confirm it again.
      rollbackSelection: SelectionState = selection,
    ): Promise<void> => {
      if (pendingRef.current) return;

      // ⚠️ **One guard for every command, because there is one rule.** Each of
      // the three callers below had its own answer to "may I still play": a
      // click checked `isOver`, End Turn relied on its button carrying
      // `disabled`, and an open attack panel relied on being unreachable. Two of
      // those are not rules, and a keyboard shortcut or a panel still open when
      // an opponent's winning move lands would slip straight past them. The
      // server refuses all three anyway; this stops the pointless round trip and
      // the rejection banner it would raise.
      if (isOver(server.getState())) return;

      pendingRef.current = true;
      setSelection(nextSelection);

      // Written against the interface, not the implementation: the real
      // GameServer never rejects (it maps transport failures to ok: false),
      // but one that did would otherwise leave the in-flight flag stuck and
      // soft-lock the UI. A thrown error reads as a rejection -- the same
      // shape the real implementation already gives a transport failure.
      let response: CommandResult;
      try {
        response = await server.submit(command);
      } catch (cause) {
        response = {
          ok: false,
          reason: cause instanceof Error ? cause.message : 'submit failed',
        };
      } finally {
        pendingRef.current = false;
      }
      if (response.ok) return;

      // A rejection produces no update, so nothing else would ever put the
      // previewed unit back -- syncUnits only runs when the server speaks.
      void callbacksRef.current.onPreview(null);
      setRejection(response.reason);
      setSelection(rollbackSelection);
    },
    [server, selection],
  );

  // Batches run in arrival order, one at a time: a poll can deliver batch
  // two while batch one is still animating. Tasks never reject (both render
  // callbacks are caught below), so a plain then keeps the chain alive --
  // one broken render must not wedge every batch after it.
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  // Single path for state changes: everything the authority decides arrives
  // here, whoever caused it. The implementation deduplicates by seq, so this
  // fires once per change whether it came from our own submit or a poll.
  //
  // The rejection clears on arrival -- newer authority supersedes it -- but
  // everything else queues: a state commits only after the events that
  // produced it have finished animating (or been snapped over). Backpressure
  // from animation is a UI concern, so the queue lives here and the
  // transport never learns it exists.
  useEffect(() => {
    return server.subscribe((events, state) => {
      setRejection(null);
      queueRef.current = queueRef.current.then(async () => {
        if (worthAnimating(events)) {
          try {
            await callbacksRef.current.onEvents(events);
          } catch (error) {
            // Snapped over and committed below -- a failed animation must
            // never wedge the queue.
            console.error('animation failed:', error);
          }
        }
        try {
          callbacksRef.current.onSnap(state);
        } catch (error) {
          console.error('snap failed:', error);
        }
        // Beside the snap rather than on arrival, so the pin and the mesh
        // correct together: outside the queue the menu would vanish while the
        // ghost kept standing until a batch finished animating. An
        // uncommitted plan does not survive the board moving under it.
        setSelection((current) => (isPlan(current) ? unpinDestination(current) : current));
        setGameState(state);
      });
    });
  }, [server]);

  const clickTile = useCallback(
    (coordinate: Coordinate): void => {
      if (pendingRef.current) return;

      // ⚠️ The board goes quiet when the game does. `submitCommand` already
      // refuses to send, so this is not about the wire -- it is that a click
      // would still *select*, draw a route and walk a preview, none of which
      // submits anything and all of which is a board pretending to be playable.
      if (isOver(server.getState())) return;

      // ⚠️ Nothing is answerable while the preview walks: `playEvents` skips a
      // move only once its mesh stands at the destination, so committing early
      // makes the committed move replay from halfway along the path. And a
      // second click on the destination would otherwise start the same walk
      // twice. `walking` has to be in this callback's deps for that to be read
      // fresh rather than from the render that pinned it.
      if (walking) return;

      // A pinned route is a plan, and a second click on its own destination is
      // what commits it to the walk. ⚠️ Read *before* `handleTileClick`, which
      // would otherwise re-pin the destination onto itself: an equal object, a
      // wasted render, and no walk. The same order firing mode uses below, and
      // for the same reason: confirm before re-pin, or the confirming click
      // re-pins what it meant to commit.
      if (
        selection.phase === 'routePinned' &&
        coordinatesEqual(coordinate, destinationOf(selection))
      ) {
        setWalking(true);
        void callbacksRef.current
          .onPreview({ unitId: selection.unitId, path: selection.path })
          .catch((error: unknown) => console.error('preview failed:', error))
          // ⚠️ Functional and phase-checked: a poll can unpin this plan while
          // the walk is in flight, and committing the captured `selection`
          // would resurrect it over authoritative state.
          .finally(() => {
            setWalking(false);
            // ⚠️ No state needed any more: the panel lights nothing, so there
            // is no band to snapshot here. Each mode builds its own tiles when
            // it is entered, from a state fresher than this one.
            setSelection((current) =>
              current.phase === 'routePinned' ? confirmRoute(current) : current,
            );
          });
        return;
      }

      // ⚠️ **One branch per mode, and each answers one question.** This was a
      // single reader deciding between target, facing and cancel, because a tile
      // click had to be *interpreted*. The panel asks for the intent first, so a
      // lit tile means exactly one thing and there is no order to get right.
      if (selection.phase === 'destinationChosen') {
        const state = server.getState();

        // ⚠️ The predicate, not a bare `step.kind === 'firing'`. TypeScript
        // narrows `selection.step` on a nested discriminant but not `selection`
        // itself, and `readFireClick` wants the whole thing -- so asking the
        // predicate does both jobs where the inline check does one and then
        // needs the predicate anyway.
        if (isAim(selection)) {
          // A second click on the pinned target is what fires it -- the same
          // gesture a route uses, read before `readFireClick` for the same
          // reason: re-pinning the target onto itself is a wasted render and no
          // shot. Dispatch order, exactly like the route's.
          if (isAiming(selection) && coordinatesEqual(coordinate, selection.step.target.position)) {
            void submitCommand(
              moveCommandFor(selection, facingForTarget(state, selection), {
                targetUnitId: selection.step.target.id,
                // ⚠️ The one place the two attack modes diverge. Everything
                // between picking a mode and committing is identical, so the
                // kind is read off the step here rather than branched on above.
                attackKind: selection.step.kind === 'charging' ? 'charge' : 'fire',
              }),
              initialSelectionState,
              unpinDestination(selection),
            );
            return;
          }

          const target = readAimClick(state, selection, coordinate);
          // A different lit enemy re-pins, exactly as a route does.
          if (target) {
            setSelection(chooseTarget(selection, target));
            return;
          }
        }

        if (selection.step.kind === 'holding') {
          const facing = readHoldClick(state, selection, coordinate);
          if (facing) {
            void submitCommand(
              moveCommandFor(selection, facing),
              initialSelectionState,
              unpinDestination(selection),
            );
            return;
          }
        }

        // ⚠️ **Two rules for backing out, not a chain.** A dark click inside a
        // mode returns to the panel; a dark click at the panel un-walks the
        // ghost and returns to move selection. "Lit does something, dark backs
        // out" is the whole rule, and it reads because at most one set is lit. A
        // click off the board never arrives here at all: the renderer drops a
        // pick that hits no tile, so the space around the board is not a way out.
        if (selection.step.kind !== 'choosing') {
          setSelection(clearStep(selection));
          return;
        }

        void callbacksRef.current.onPreview(null);
        setSelection(unpinDestination(selection));
        return;
      }

      // The authoritative board, not the replica (invariant 1) -- the replica
      // is in scope and tempting, and a beat old. Otherwise a click commits
      // nothing: it picks a destination, and the menu decides from there.
      // Nothing commits here: a click picks or moves a pin, and the second
      // click on it decides. ⚠️ No walk is started on this path at all, which
      // is what retired the identity check that used to guard it.
      setSelection(handleTileClick(server.getState(), selection, coordinate));
    },
    [server, selection, submitCommand, walking],
  );

  /**
   * Commit from the panel: `withTarget` fires, otherwise the unit just ends up
   * looking at them.
   *
   * ⚠️ Both face the target, which is why Hold has to exist here at all -- the
   * only tile that would face an adjacent enemy is the one they are standing on,
   * so without a button there is no way to turn toward someone without shooting.
   */
  const chooseAction = useCallback(
    (kind: 'firing' | 'charging' | 'holding'): void => {
      if (pendingRef.current) return;
      setSelection((current) =>
        current.phase === 'destinationChosen'
          ? enterMode(server.getState(), current, kind)
          : current,
      );
    },
    [server],
  );

  const endTurn = useCallback((): void => {
    void submitCommand({ type: 'endTurn' }, initialSelectionState);
  }, [submitCommand]);

  return {
    gameState,
    rejection,
    selection,
    walking,
    clickTile,
    chooseAction,
    endTurn,
  };
}
