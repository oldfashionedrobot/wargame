import { useEffect, useRef, useState } from 'react'
import { handleTileClick, initialSelectionState } from './interaction/selection'
import type { SelectionState } from './interaction/selection'
import { createInitialState } from '@aw/server'
import { applyAction, getCurrentPlayer } from '@aw/shared'
import type { GameState } from '@aw/shared'
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
  const [gameState, setGameState] = useState<GameState>(createInitialState)
  const gameStateRef = useRef(gameState)
  const selectionRef = useRef<SelectionState>(initialSelectionState)
  const rendererRef = useRef<GameRenderer | null>(null)

  useEffect(() => {
    gameStateRef.current = gameState
  }, [gameState])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = createGameRenderer(canvas, gameStateRef.current)
    rendererRef.current = renderer

    renderer.onTileClick((coordinate) => {
      const currentState = gameStateRef.current
      const result = handleTileClick(currentState, selectionRef.current, coordinate)
      selectionRef.current = result.selection
      showSelection(renderer, currentState, result.selection)

      if (!result.command) return
      const applied = applyAction(currentState, result.command)
      if (!applied.ok) return

      if (result.command.type === 'move') renderer.playMove(result.command)
      setGameState(applied.state)
    })

    return () => {
      renderer.dispose()
      rendererRef.current = null
    }
  }, [])

  const handleEndTurn = (): void => {
    const applied = applyAction(gameStateRef.current, { type: 'endTurn' })
    if (!applied.ok) return

    selectionRef.current = initialSelectionState
    if (rendererRef.current) {
      showSelection(rendererRef.current, applied.state, initialSelectionState)
    }
    setGameState(applied.state)
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
      </div>
    </div>
  )
}
