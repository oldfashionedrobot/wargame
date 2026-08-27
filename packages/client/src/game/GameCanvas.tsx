import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentPlayer } from '@vod/shared';
import type { Command, GameServer, GameState } from '@vod/shared';
import { handleTileClick, initialSelectionState } from './interaction/selection';
import type { SelectionState } from './interaction/selection';
import type { ConnectionStatus } from '../net/gameServer';
import { createGameRenderer } from './render/renderer';
import type { GameRenderer } from './render/renderer';

// Pushes a selection to the renderer. Module-level so there's one place that
// knows how a selection is displayed -- attacking adds a third overlay here.
function showSelection(renderer: GameRenderer, state: GameState, selection: SelectionState): void {
  const selectedUnit = state.units.find((unit) => unit.id === selection.selectedUnitId);
  renderer.setSelectedTile(selectedUnit ? selectedUnit.position : null);
  renderer.setMovementRange(selection.reachableTiles);
}

export interface GameCanvasProps {
  server: GameServer;
  connection: ConnectionStatus;
}

export function GameCanvas({ server, connection }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // The server owns game state; this is a render replica, fed by subscribe().
  // Anything needing the authoritative value reads server.getState() directly
  // rather than this -- a second copy would only be a second thing to desync.
  const [gameState, setGameState] = useState<GameState>(() => server.getState());
  const [rejection, setRejection] = useState<string | null>(null);
  const selectionRef = useRef<SelectionState>(initialSelectionState);
  const rendererRef = useRef<GameRenderer | null>(null);
  // A command is a round trip now, so a second click can land before the first
  // resolves. Both would read the same state and submit against it; the server
  // rejects the loser, but the UI would already have moved on.
  const pendingRef = useRef(false);

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
      const renderer = rendererRef.current;
      if (!renderer || pendingRef.current) return;

      const previousSelection = selectionRef.current;
      pendingRef.current = true;
      selectionRef.current = nextSelection;
      showSelection(renderer, server.getState(), nextSelection);

      const response = await server.submit(command);
      pendingRef.current = false;
      if (response.ok) return;

      setRejection(response.reason);
      selectionRef.current = previousSelection;
      showSelection(renderer, server.getState(), previousSelection);
    },
    [server],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = createGameRenderer(canvas, server.getState());
    rendererRef.current = renderer;

    // Single path for state changes: everything the authority decides arrives
    // here, whoever caused it. The implementation deduplicates by seq, so this
    // fires once per change whether it came from our own submit or a poll.
    const unsubscribe = server.subscribe((events, state) => {
      setGameState(state);
      setRejection(null);
      renderer.playEvents(events).catch((error: unknown) => {
        console.error('animation failed:', error);
      });
    });

    renderer.onTileClick((coordinate) => {
      if (pendingRef.current) return;

      const currentState = server.getState();
      const result = handleTileClick(currentState, selectionRef.current, coordinate);

      // Selection-only clicks are pure UI and commit immediately; anything
      // carrying a command goes through submitCommand so it can be undone.
      if (!result.command) {
        selectionRef.current = result.selection;
        showSelection(renderer, currentState, result.selection);
        return;
      }

      void submitCommand(result.command, result.selection);
    });

    return () => {
      unsubscribe();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [server, submitCommand]);

  const handleEndTurn = (): void => {
    void submitCommand({ type: 'endTurn' }, initialSelectionState);
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{ width: '100vw', height: '90vh', display: 'block', touchAction: 'none' }}
      />
      <div>
        <span>{getCurrentPlayer(gameState).name}&apos;s turn</span>{' '}
        <button type="button" onClick={handleEndTurn}>
          End Turn
        </button>{' '}
        {import.meta.env.DEV && (
          <button type="button" onClick={() => rendererRef.current?.toggleInspector()}>
            Toggle Inspector
          </button>
        )}
        {rejection && <span style={{ color: '#c0392b' }}> rejected: {rejection}</span>}
        {connection === 'retrying' && <span style={{ color: '#b9770e' }}> reconnecting…</span>}
      </div>
    </div>
  );
}
