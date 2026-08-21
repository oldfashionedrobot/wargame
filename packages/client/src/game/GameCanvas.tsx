import { useEffect, useRef, useState } from 'react'
import { createInitialState, createLocalGameServer } from '@aw/server'
import { getCurrentPlayer } from '@aw/shared'
import type { GameServer, GameState } from '@aw/shared'
import { handleTileClick, initialSelectionState } from './interaction/selection'
import type { SelectionState } from './interaction/selection'
import { createGameRenderer } from './render/renderer'
import type { GameRenderer } from './render/renderer'

// Pushes a selection to the renderer. Module-level so there's one place that
// knows how a selection is displayed -- attacking adds a third overlay here.
function showSelection(renderer: GameRenderer, state: GameState, selection: SelectionState): void {
  const selectedUnit = state.units.find((unit) => unit.id === selection.selectedUnitId)
  renderer.setSelectedTile(selectedUnit ? selectedUnit.position : null)
  renderer.setMovementRange(selection.reachableTiles)
}

export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Constructed once, never replaced. useState rather than a ref so it can be
  // read during render without tripping the rules of hooks.
  const [server] = useState<GameServer>(() => createLocalGameServer(createInitialState()))

  // The server owns game state; this is a render replica, fed by subscribe().
  // Anything needing the authoritative value reads server.getState() directly
  // rather than this -- a second copy would only be a second thing to desync.
  const [gameState, setGameState] = useState<GameState>(() => server.getState())
  const [rejection, setRejection] = useState<string | null>(null)
  const selectionRef = useRef<SelectionState>(initialSelectionState)
  const rendererRef = useRef<GameRenderer | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = createGameRenderer(canvas, server.getState())
    rendererRef.current = renderer

    // Single path for state changes: everything the authority decides arrives
    // here, whoever caused it. submit() is consulted only for rejections.
    const unsubscribe = server.subscribe((events, state) => {
      setGameState(state)
      setRejection(null)
      renderer.playEvents(events).catch((error: unknown) => {
        console.error('animation failed:', error)
      })
    })

    renderer.onTileClick((coordinate) => {
      const currentState = server.getState()
      const result = handleTileClick(currentState, selectionRef.current, coordinate)
      selectionRef.current = result.selection
      showSelection(renderer, currentState, result.selection)

      if (!result.command) return
      void server.submit(result.command).then((response) => {
        if (!response.ok) setRejection(response.reason)
      })
    })

    return () => {
      unsubscribe()
      renderer.dispose()
      rendererRef.current = null
    }
  }, [server])

  const handleEndTurn = (): void => {
    void server.submit({ type: 'endTurn' }).then((response) => {
      if (!response.ok) {
        setRejection(response.reason)
        return
      }
      selectionRef.current = initialSelectionState
      if (rendererRef.current) {
        showSelection(rendererRef.current, server.getState(), initialSelectionState)
      }
    })
  }

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
      </div>
    </div>
  )
}
