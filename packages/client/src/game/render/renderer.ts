import {
  ArcRotateCamera,
  Camera,
  Color3,
  Engine,
  HemisphericLight,
  Mesh,
  PointerEventTypes,
  Scene,
  Vector3,
} from '@babylonjs/core'
import type { Coordinate, GameEvent, GameState } from '@aw/shared'
import { createGridLines } from './gridLines'
import { createTileHighlight, setHighlightTile } from './highlight'
import { createMovementRangeOverlay, setMovementRangeTiles } from './movementRange'
import { screenToTile } from './picking'
import { createTerrainMesh } from './terrain'
import { animateUnitAlongPath, createUnitMesh } from './units'

const ORTHO_ZOOM_PADDING = 0.7

const HOVER_COLOR = new Color3(1, 1, 1)
const HOVER_ALPHA = 0.6
const HOVER_HEIGHT = 0.02

const SELECTED_COLOR = new Color3(1, 0.85, 0.1)
const SELECTED_ALPHA = 0.55
const SELECTED_HEIGHT = 0.025

export interface GameRenderer {
  onTileClick(handler: (coordinate: Coordinate) => void): void
  setSelectedTile(coordinate: Coordinate | null): void
  setMovementRange(coordinates: Coordinate[]): void
  /** Animates what the authority says happened. Resolves when done. */
  playEvents(events: GameEvent[]): Promise<void>
  toggleInspector(): void
  dispose(): void
}

// Dev-only: the Inspector UI ships in a separate package, dynamically
// imported here so it's never pulled into a production bundle.
async function toggleInspector(scene: Scene): Promise<void> {
  if (!import.meta.env.DEV) return

  if (scene.debugLayer.isVisible()) {
    scene.debugLayer.hide()
    return
  }

  await import('@babylonjs/inspector')
  await scene.debugLayer.show({ embedMode: true })
}

export function createGameRenderer(canvas: HTMLCanvasElement, initialState: GameState): GameRenderer {
  const gridHeight = initialState.grid.length
  const gridWidth = initialState.grid[0]?.length ?? 0

  const engine = new Engine(canvas, true)
  const scene = new Scene(engine)

  const camera = new ArcRotateCamera(
    'camera',
    -Math.PI / 2,
    Math.PI / 3.5,
    Math.max(gridWidth, gridHeight),
    Vector3.Zero(),
    scene,
  )
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA
  camera.attachControl(canvas, true)

  const applyOrthoBounds = (): void => {
    const zoom = Math.max(gridWidth, gridHeight) * ORTHO_ZOOM_PADDING
    const aspect = canvas.clientWidth / canvas.clientHeight
    camera.orthoLeft = -zoom * aspect
    camera.orthoRight = zoom * aspect
    camera.orthoTop = zoom
    camera.orthoBottom = -zoom
  }
  applyOrthoBounds()

  const light = new HemisphericLight('light', new Vector3(0, 1, 0.3), scene)
  light.intensity = 0.9

  createTerrainMesh(scene, initialState.grid)
  createGridLines(scene, gridWidth, gridHeight)
  const hoverHighlight = createTileHighlight(scene, 'hover-highlight', HOVER_COLOR, HOVER_ALPHA)
  const selectedHighlight = createTileHighlight(scene, 'selected-highlight', SELECTED_COLOR, SELECTED_ALPHA)
  const movementRange = createMovementRangeOverlay(scene)

  const unitMeshes = new Map<string, Mesh>()
  for (const unit of initialState.units) {
    const owner = initialState.players.find((player) => player.id === unit.owner)
    if (!owner) throw new Error(`unit ${unit.id} has unknown owner ${unit.owner}`)
    unitMeshes.set(unit.id, createUnitMesh(scene, unit, owner.color, gridWidth, gridHeight))
  }

  const hoveredCoordinate = (): Coordinate | null =>
    screenToTile(scene, camera, scene.pointerX, scene.pointerY, gridWidth, gridHeight)

  let clickHandler: ((coordinate: Coordinate) => void) | null = null
  scene.onPointerObservable.add((pointerInfo) => {
    if (pointerInfo.type === PointerEventTypes.POINTERMOVE) {
      setHighlightTile(hoverHighlight, hoveredCoordinate(), HOVER_HEIGHT, gridWidth, gridHeight)
      return
    }

    if (pointerInfo.type === PointerEventTypes.POINTERPICK && clickHandler) {
      const coordinate = hoveredCoordinate()
      if (coordinate) clickHandler(coordinate)
    }
  })

  engine.runRenderLoop(() => {
    scene.render()
  })

  const handleResize = (): void => {
    engine.resize()
    applyOrthoBounds()
  }
  window.addEventListener('resize', handleResize)

  return {
    onTileClick(handler) {
      clickHandler = handler
    },
    setSelectedTile(coordinate) {
      setHighlightTile(selectedHighlight, coordinate, SELECTED_HEIGHT, gridWidth, gridHeight)
    },
    setMovementRange(coordinates) {
      setMovementRangeTiles(movementRange, coordinates, gridWidth, gridHeight)
    },
    async playEvents(events) {
      for (const event of events) {
        if (event.type !== 'unitMoved') continue
        const mesh = unitMeshes.get(event.unitId)
        if (!mesh) continue
        await animateUnitAlongPath(mesh, event.path, gridWidth, gridHeight, scene)
      }
    },
    toggleInspector() {
      void toggleInspector(scene)
    },
    dispose() {
      window.removeEventListener('resize', handleResize)
      engine.dispose()
    },
  }
}
