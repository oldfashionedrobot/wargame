import { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';
import type { TileType } from '@vod/shared';
import { TILE_SIZE, tileToWorld } from './coordinates';
import { composeTerrain } from './composeTerrain';
import { tileUvs } from './terrainAtlas';

// Terrain stays flat, and not only for now: screenToTile intersects the y=0
// plane rather than picking meshes, so a mountain with real height would have
// you click its peak and select the tile behind it.

// Overlays sit just clear of the ground and well under the movement overlays
// at 0.015 and up, so a range tint draws over a forest rather than beneath it.
const OVERLAY_HEIGHT = 0.005;

/** One quad per cell, at `height`, sampling whichever atlas index it is given. */
function quadLayer(
  name: string,
  scene: Scene,
  cells: { col: number; row: number; tile: number; turns: number }[],
  gridWidth: number,
  gridHeight: number,
  height: number,
): Mesh {
  const half = TILE_SIZE / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  let vertexIndex = 0;
  for (const { col, row, tile, turns } of cells) {
    const center = tileToWorld({ col, row }, gridWidth, gridHeight);

    // One vertex per line; flattening into a column loses the shape.
    // prettier-ignore
    positions.push(
      center.x - half, height, center.z - half,
      center.x + half, height, center.z - half,
      center.x + half, height, center.z + half,
      center.x - half, height, center.z + half,
    )
    for (let i = 0; i < 4; i++) normals.push(0, 1, 0);
    uvs.push(...tileUvs(tile, turns));

    // One triangle per line.
    // prettier-ignore
    indices.push(
      vertexIndex, vertexIndex + 2, vertexIndex + 1,
      vertexIndex, vertexIndex + 3, vertexIndex + 2,
    )
    vertexIndex += 4;
  }

  const mesh = new Mesh(name, scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.normals = normals;
  vertexData.uvs = uvs;
  vertexData.indices = indices;
  vertexData.applyToMesh(mesh);
  return mesh;
}

export function createTerrainMesh(scene: Scene, grid: TileType[][], atlas: Texture): Mesh {
  const gridHeight = grid.length;
  const gridWidth = grid[0]?.length ?? 0;
  const cells = composeTerrain(grid);

  const ground: { col: number; row: number; tile: number; turns: number }[] = [];
  const overlays: { col: number; row: number; tile: number; turns: number }[] = [];
  for (let row = 0; row < gridHeight; row++) {
    for (let col = 0; col < gridWidth; col++) {
      const cell = cells[row][col];
      ground.push({ col, row, tile: cell.ground, turns: cell.turns });
      if (cell.overlay !== undefined) {
        overlays.push({ col, row, tile: cell.overlay, turns: 0 });
      }
    }
  }

  const mesh = quadLayer('terrain', scene, ground, gridWidth, gridHeight, 0);
  const material = new StandardMaterial('terrain-material', scene);
  material.diffuseTexture = atlas;
  material.diffuseColor = new Color3(1, 1, 1);
  material.specularColor = new Color3(0, 0, 0);
  material.backFaceCulling = false;
  mesh.material = material;

  // Only the cells that have something on them get a quad, so this is empty on
  // a map with no woods or peaks.
  if (overlays.length > 0) {
    const overlayMesh = quadLayer(
      'terrain-overlay',
      scene,
      overlays,
      gridWidth,
      gridHeight,
      OVERLAY_HEIGHT,
    );
    const overlayMaterial = new StandardMaterial('terrain-overlay-material', scene);
    overlayMaterial.diffuseTexture = atlas;
    overlayMaterial.diffuseColor = new Color3(1, 1, 1);
    overlayMaterial.specularColor = new Color3(0, 0, 0);
    overlayMaterial.backFaceCulling = false;
    // Alpha *test*, not blend: the art has hard-edged binary transparency, so a
    // cut-off keeps the pixels crisp and sidesteps transparency sorting.
    atlas.hasAlpha = true;
    overlayMaterial.useAlphaFromDiffuseTexture = true;
    overlayMaterial.transparencyMode = Material.MATERIAL_ALPHATEST;
    overlayMaterial.alphaCutOff = 0.5;
    overlayMesh.material = overlayMaterial;
    overlayMesh.parent = mesh;
  }

  return mesh;
}
