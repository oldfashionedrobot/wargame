import { Color4, LinesMesh, MeshBuilder, Scene, Vector3 } from '@babylonjs/core'
import { gridBounds, TILE_SIZE } from './coordinates'

const LINE_HEIGHT = 0.01 // just above the terrain surface to avoid z-fighting
const LINE_COLOR = new Color4(0.15, 0.2, 0.1, 1)
const LINE_ALPHA = 0.35

export function createGridLines(scene: Scene, gridWidth: number, gridHeight: number): LinesMesh {
  const { minX, maxX, minZ, maxZ } = gridBounds(gridWidth, gridHeight)

  const lines: Vector3[][] = []
  for (let col = 0; col <= gridWidth; col++) {
    const x = minX + col * TILE_SIZE
    lines.push([new Vector3(x, LINE_HEIGHT, minZ), new Vector3(x, LINE_HEIGHT, maxZ)])
  }
  for (let row = 0; row <= gridHeight; row++) {
    const z = minZ + row * TILE_SIZE
    lines.push([new Vector3(minX, LINE_HEIGHT, z), new Vector3(maxX, LINE_HEIGHT, z)])
  }

  const colors = lines.map((line) => line.map(() => LINE_COLOR))
  const gridLines = MeshBuilder.CreateLineSystem('grid-lines', { lines, colors }, scene)
  gridLines.alpha = LINE_ALPHA
  return gridLines
}
