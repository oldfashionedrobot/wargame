import { useCallback, useEffect, useRef, useState } from 'react';
import type { Command, Coordinate, GameEvent, GameServer, GameState } from '@vod/shared';
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
  /** The authority decided these happened -- animate them, in order. */
  onEvents: (events: GameEvent[]) => void;
}

export interface GameSession {
  /**
   * Render replica of the server's state, fed by subscribe(). Display only --
   * anything needing the authoritative value reads server.getState() instead
   * (invariant 1); a second copy would only be a second thing to desync.
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

      const response = await server.submit(command);
      pendingRef.current = false;
      if (response.ok) return;

      setRejection(response.reason);
      applySelection(previousSelection);
    },
    [server, applySelection],
  );

  // Single path for state changes: everything the authority decides arrives
  // here, whoever caused it. The implementation deduplicates by seq, so this
  // fires once per change whether it came from our own submit or a poll.
  useEffect(() => {
    return server.subscribe((events, state) => {
      setGameState(state);
      setRejection(null);
      callbacksRef.current.onEvents(events);
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
