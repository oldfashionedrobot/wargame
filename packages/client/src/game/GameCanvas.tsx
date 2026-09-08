import { useCallback, useEffect, useRef } from 'react';
import { getCurrentPlayer } from '@vod/shared';
import type { GameEvent, GameServer, GameState } from '@vod/shared';
import { useGameSession } from './useGameSession';
import type { SelectionState } from './interaction/selection';
import type { ConnectionStatus } from '../net/gameServer';
import { createGameRenderer } from './render/renderer';
import type { GameRenderer } from './render/renderer';

// Pushes a selection to the renderer. Module-level so there's one place that
// knows how a selection is displayed -- attacking adds a third overlay here.
// A pure projection of the selection: everything it draws is on the snapshot,
// so there is no game state to fetch and no question of which copy to read.
function showSelection(renderer: GameRenderer, selection: SelectionState): void {
  renderer.setSelectedTile(selection.phase === 'unitSelected' ? selection.position : null);
  renderer.setMovementRange(selection.phase === 'unitSelected' ? selection.movement.reachable : []);
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
  // submit can resolve after this canvas unmounted, and its rollback push must
  // find null rather than a disposed renderer.
  const onSelectionChange = useCallback((selection: SelectionState): void => {
    const renderer = rendererRef.current;
    if (renderer) showSelection(renderer, selection);
  }, []);

  const onEvents = useCallback(
    (events: GameEvent[]): Promise<void> =>
      rendererRef.current?.playEvents(events) ?? Promise.resolve(),
    [],
  );

  const onSnap = useCallback((state: GameState): void => {
    rendererRef.current?.snapUnits(state);
  }, []);

  const { gameState, rejection, clickTile, endTurn } = useGameSession(server, {
    onSelectionChange,
    onEvents,
    onSnap,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = createGameRenderer(canvas, server.getState());
    rendererRef.current = renderer;
    renderer.onTileClick(clickTile);

    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [server, clickTile]);

  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{ width: '100vw', height: '90vh', display: 'block', touchAction: 'none' }}
      />
      <div>
        <span>{getCurrentPlayer(gameState).name}&apos;s turn</span>{' '}
        <button type="button" onClick={endTurn}>
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
