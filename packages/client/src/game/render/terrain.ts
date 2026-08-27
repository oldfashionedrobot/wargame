import { Color3, Color4, Mesh, Scene, StandardMaterial, VertexData } from '@babylonjs/core';
import type { TileType } from '@aw/shared';
import { TILE_SIZE, tileToWorld } from './coordinates';

const TILE_COLORS: Record<TileType, Color4> = {
  land: new Color4(0.55, 0.73, 0.4, 1),
};

export function createTerrainMesh(scene: Scene, grid: TileType[][]): Mesh {
  const gridHeight = grid.length;
  const gridWidth = grid[0]?.length ?? 0;
  const half = TILE_SIZE / 2;

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
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

      const color = TILE_COLORS[grid[row][col]];
      for (let i = 0; i < 4; i++) colors.push(color.r, color.g, color.b, color.a);

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
  vertexData.colors = colors;
  vertexData.indices = indices;
  vertexData.applyToMesh(mesh);

  const material = new StandardMaterial('terrain-material', scene);
  material.diffuseColor = new Color3(1, 1, 1);
  material.specularColor = new Color3(0, 0, 0);
  material.backFaceCulling = false;
  mesh.material = material;

  return mesh;
}
