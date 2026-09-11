import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';
import type { TileType } from '@vod/shared';
import { tileToWorld } from './coordinates';
import { QUARTER_TURN } from './composeTerrain';
import type { TerrainCell } from './composeTerrain';
import type { TerrainModels } from './terrainModels';

// Height here is a *look*, never data: the map has no elevation, movement costs
// nothing extra to climb, and screenToTile still answers by intersecting y = 0
// rather than picking a mesh. What that buys is a hard ceiling on how tall
// anything walkable may be -- see `topOf` -- not a rule that everything is flat.

/**
 * Builds the board out of models, then merges what it built.
 *
 * Merging rather than instancing because terrain is made once and never moves,
 * which is the case merging is for: grouping every tile's meshes by material
 * leaves about eight draw calls for a whole board, against roughly thirty
 * instanced and four hundred as loose copies. At this size any of them would
 * do -- this is the simplest option that also happens to be the fastest.
 */
export function createTerrainMesh(
  scene: Scene,
  grid: TileType[][],
  models: TerrainModels,
  cells: TerrainCell[][],
): Mesh {
  const gridHeight = grid.length;
  const gridWidth = grid[0]?.length ?? 0;

  const built: AbstractMesh[] = [];

  for (let row = 0; row < gridHeight; row++) {
    for (let col = 0; col < gridWidth; col++) {
      const cell = cells[row][col];
      const center = tileToWorld({ col, row }, gridWidth, gridHeight);

      const ground = models.instantiate(cell.ground, `tile-${col}-${row}`);
      ground.position.set(center.x, 0, center.z);
      ground.rotation.y = cell.turns * QUARTER_TURN;
      built.push(...ground.getChildMeshes());

      // Placement is entirely the tiler's call -- this only obeys it. On top
      // of whatever the ground turned out to be, so stone sits on its pad
      // rather than inside it.
      cell.props.forEach((prop, i) => {
        const node = models.instantiate(prop.model, `prop-${col}-${row}-${i}`);
        node.position.set(center.x + prop.x, models.topOf(cell.ground), center.z + prop.z);
        node.rotation.y = prop.rotation;
        node.scaling.setAll(prop.scale);
        built.push(...node.getChildMeshes());
      });
    }
  }

  return mergeByMaterial(scene, built);
}

/**
 * One mesh per material, with the loose copies disposed.
 *
 * Leans on `terrainModels` having already shared materials by name: without
 * that, every file would contribute its own `grass` and this would group by
 * nothing.
 */
function mergeByMaterial(scene: Scene, meshes: AbstractMesh[]): Mesh {
  const groups = new Map<string, Mesh[]>();
  const materials = new Map<string, Material>();
  for (const mesh of meshes) {
    // The loader hangs an empty node above each model to carry the handedness
    // conversion, and it comes back from getChildMeshes with no vertices at
    // all. Merging one throws rather than ignoring it.
    if (!(mesh instanceof Mesh) || mesh.getTotalVertices() === 0) continue;
    const key = mesh.material?.name ?? 'none';
    if (mesh.material) materials.set(key, mesh.material);
    const group = groups.get(key);
    if (group) group.push(mesh);
    else groups.set(key, [mesh]);
  }

  const board = new Mesh('terrain', scene);
  for (const [name, group] of groups) {
    // Merging bakes each copy's world transform into its vertices, which is
    // what lets one mesh hold tiles that were rotated differently.
    const merged = Mesh.MergeMeshes(group, true, true);
    if (!merged) continue;
    merged.name = `terrain-${name}`;
    // Re-applied by hand: the sources are disposed as part of merging, and the
    // merged mesh does not reliably inherit their material -- which shows up as
    // a board that has exactly the right shape and no colour at all.
    const material = materials.get(name);
    if (material) merged.material = material;
    merged.parent = board;
    merged.isPickable = false; // picking is plane arithmetic, never a ray at a mesh
  }
  return board;
}
