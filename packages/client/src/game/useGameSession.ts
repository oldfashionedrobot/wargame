import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Command,
  CommandResult,
  Coordinate,
  GameEvent,
  GameServer,
  GameState,
} from '@vod/shared';
import { handleTileClick, initialSelectionState } from './interaction/selection';
import type { SelectionState } from './interaction/selection';

// The session half of what GameCanvas used to own -- everything about playing
// a match that is not Babylon: the render replica, the rejection, the
// in-flight guard, the selection, and the submits. The canvas half stays a
// consumer: it supplies the two callbacks and never hands the hook a renderer,
// so the hook never learns what Babylon is.

export interface GameSessionCallbacks {
  /** The selection changed -- push it to whatever displays it. */
  onSelectionChange: (selection: SelectionState) => void;
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
}

// Animate small live batches; snap everything else. The cap separates "a
// dropped poll" from "gone a while" -- these are chess-length games, and
// catch-up replay at tween speed is worse than useless. Hidden tabs skip
// too: browsers throttle rAF there, so an awaited animation would stall the
// queue rather than play.
//
// Counted in tiles rather than events, because that is what costs time: a
// move animates per step, so ten long moves is far more waiting than ten
// short ones. At 0.3s a tile this is a bit over four seconds.
const MAX_ANIMATED_TILES = 14;

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
  clickTile: (coordinate: Coordinate) => void;
  endTurn: () => void;
}

export function useGameSession(server: GameServer, callbacks: GameSessionCallbacks): GameSession {
  const [gameState, setGameState] = useState<GameState>(() => server.getState());
  const [rejection, setRejection] = useState<string | null>(null);
  const selectionRef = useRef<SelectionState>(initialSelectionState);
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

  // The one write path for the selection: set the ref, push it out. Keeping
  // the pair in one place is what stops a call site from setting the ref and
  // forgetting the push, which desyncs the highlight silently.
  const applySelection = useCallback((next: SelectionState): void => {
    selectionRef.current = next;
    callbacksRef.current.onSelectionChange(next);
  }, []);

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
    async (command: Command, nextSelection: SelectionState): Promise<void> => {
      if (pendingRef.current) return;

      const previousSelection = selectionRef.current;
      pendingRef.current = true;
      applySelection(nextSelection);

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

      setRejection(response.reason);
      applySelection(previousSelection);
    },
    [server, applySelection],
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
        setGameState(state);
      });
    });
  }, [server]);

  const clickTile = useCallback(
    (coordinate: Coordinate): void => {
      if (pendingRef.current) return;

      // The authoritative board, not the replica (invariant 1) -- the replica
      // is in scope and tempting, and a beat old.
      const result = handleTileClick(server.getState(), selectionRef.current, coordinate);

      // Selection-only clicks are pure UI and commit immediately; anything
      // carrying a command goes through submitCommand so it can be undone.
      if (!result.command) {
        applySelection(result.selection);
        return;
      }
      void submitCommand(result.command, result.selection);
    },
    [server, submitCommand, applySelection],
  );

  const endTurn = useCallback((): void => {
    void submitCommand({ type: 'endTurn' }, initialSelectionState);
  }, [submitCommand]);

  return { gameState, rejection, clickTile, endTurn };
}
