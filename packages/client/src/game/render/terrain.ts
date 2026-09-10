import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';
import type { TileType } from '@vod/shared';
import { TILE_SIZE, tileToWorld } from './coordinates';
import { tileUvs } from './terrainAtlas';

// Terrain stays flat, and not only for now: screenToTile intersects the y=0
// plane rather than picking meshes, so a mountain with real height would have
// you click its peak and select the tile behind it.

// 7.5a: one atlas index for every cell, whatever the terrain, so that the UV
// plumbing can be judged on its own. `184` is the numeral 4 -- deliberately
// asymmetric, because a tile that reads correctly settles both the grid's
// north and the sheet's v axis at once, and a flip in either is unmistakable.
const PROBE_TILE = 184;

export function createTerrainMesh(scene: Scene, grid: TileType[][], atlas: Texture): Mesh {
  const gridHeight = grid.length;
  const gridWidth = grid[0]?.length ?? 0;
  const half = TILE_SIZE / 2;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  let vertexIndex = 0;
  for (let row = 0; row < gridHeight; row++) {
    for (let col = 0; col < gridWidth; col++) {
      const center = tileToWorld({ col, row }, gridWidth, gridHeight);

      // One vertex per line; flattening into a column loses the shape.
      // prettier-ignore
      positions.push(
        center.x - half, 0, center.z - half,
        center.x + half, 0, center.z - half,
        center.x + half, 0, center.z + half,
        center.x - half, 0, center.z + half,
      )
      for (let i = 0; i < 4; i++) normals.push(0, 1, 0);

      uvs.push(...tileUvs(PROBE_TILE));

      // One triangle per line.
      // prettier-ignore
      indices.push(
        vertexIndex, vertexIndex + 2, vertexIndex + 1,
        vertexIndex, vertexIndex + 3, vertexIndex + 2,
      )
      vertexIndex += 4;
    }
  }

  const mesh = new Mesh('terrain', scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.normals = normals;
  vertexData.uvs = uvs;
  vertexData.indices = indices;
  vertexData.applyToMesh(mesh);

  const material = new StandardMaterial('terrain-material', scene);
  material.diffuseTexture = atlas;
  material.diffuseColor = new Color3(1, 1, 1);
  material.specularColor = new Color3(0, 0, 0);
  material.backFaceCulling = false;
  mesh.material = material;

  return mesh;
}
