// Side effect: registers the .glb loader. Already imported by unitModels, but
// stated here too -- this module does not want to depend on load order.
import '@babylonjs/loaders/glTF/2.0';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';

// Kenney's Nature Kit, CC0. Every ground model is exactly 1x1 in x and z and
// flat-topped at y = 0, which is TILE_SIZE and the plane screenToTile already
// intersects -- so a flat board needs no picking change. See the licence
// alongside them in public/models/terrain/.
const MODEL_DIR = '/models/terrain';

/** Every model the tiler can ask for. A name not in here is a compile error. */
export const TERRAIN_MODELS = [
  'ground_grass',
  // Water, as a body: the mask counts water neighbours, so these are named for
  // where the *land* is.
  'ground_riverOpen',
  'ground_riverSide',
  'ground_riverCorner',
  'ground_riverStraight',
  'ground_riverEnd',
  'ground_riverTile',
  'ground_riverCornerSmall',
  // Roads, as connectors -- a road is never a body of anything.
  'ground_pathCross',
  'ground_pathSplit',
  'ground_pathBend',
  'ground_pathStraight',
  'ground_pathEnd',
  'ground_pathTile',
  // Things that stand on the ground rather than being it.
  'bridge_wood',
  'tree_default',
  // A spire rather than a boulder, and *stone* rather than rock: the rock
  // variants are made of `dirt`, the same brown as every road and riverbank,
  // which is precisely the thing a mountain needs to not look like.
  'stone_tallI',
] as const;

export type TerrainModel = (typeof TERRAIN_MODELS)[number];

export interface TerrainModels {
  /**
   * A fresh copy of one model, parented to a node of ours.
   *
   * The caller owns the returned node's transform. The loader's own `__root__`
   * stays underneath it carrying the right-handed-to-left-handed conversion as
   * a negative scale, which a rotation set on it would compose with and get
   * wrong -- the same reason unit models are wrapped.
   */
  instantiate(model: TerrainModel, name: string): TransformNode;
}

/**
 * Loads every terrain model once, sharing materials by name across all of them.
 *
 * The sharing is the point: `grass` appears in `ground_grass`, `ground_riverSide`
 * and `rock_largeA`, and a separate instance per file would defeat merging by
 * material later -- the difference between about eight draw calls for a board
 * and about thirty.
 */
export async function loadTerrainModels(scene: Scene): Promise<TerrainModels> {
  const containers = await Promise.all(
    TERRAIN_MODELS.map((model) => LoadAssetContainerAsync(`${MODEL_DIR}/${model}.glb`, scene)),
  );

  const byModel = new Map(TERRAIN_MODELS.map((model, i) => [model, containers[i]]));
  const sharedMaterials = new Map<string, StandardMaterial>();

  return {
    instantiate(model, name) {
      const container = byModel.get(model);
      if (!container) throw new Error(`no terrain model: ${model}`);

      const holder = new TransformNode(name, scene);
      const entries = container.instantiateModelsToScene((source) => `${name}-${source}`, false);
      for (const root of entries.rootNodes) root.parent = holder;

      for (const mesh of holder.getChildMeshes()) shareMaterial(scene, mesh, sharedMaterials);
      return holder;
    },
  };
}

/**
 * One flat material per name, shared by every mesh that asked for it.
 *
 * ⚠️ The loaded material is *replaced*, not reused. The kit ships PBR materials
 * with `metallicFactor: 1`, and a fully metallic surface has no diffuse
 * response — with no environment map to reflect, a whole board renders as blank
 * white. Taking the albedo onto a plain matte `StandardMaterial` also puts
 * terrain and units in the same lighting model, which is the other half of why
 * they used to look like different substances.
 */
function shareMaterial(
  scene: Scene,
  mesh: AbstractMesh,
  shared: Map<string, StandardMaterial>,
): void {
  const source = mesh.material;
  if (!source) return;

  const existing = shared.get(source.name);
  if (existing) {
    mesh.material = existing;
    return;
  }

  const flat = new StandardMaterial(`terrain-${source.name}`, scene);
  flat.diffuseColor =
    source instanceof PBRMaterial ? source.albedoColor.clone() : new Color3(1, 1, 1);
  flat.specularColor = new Color3(0, 0, 0);
  // Named for the source, so merging can still group by it.
  shared.set(source.name, flat);
  mesh.material = flat;
}
