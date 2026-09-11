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

      for (const mesh of holder.getChildMeshes()) {
        shareMaterial(scene, model, mesh, sharedMaterials);
      }
      return holder;
    },
  };
}

/**
 * Roads get their own earth, rather than the riverbanks'.
 *
 * ⚠️ The kit paints a path and a riverbank with the same two materials, `dirt`
 * and `dirtDark`, which left a road and a river almost the same object on the
 * board -- one just had water down the middle. The shapes were never the
 * problem, so this recolours rather than re-models: a cool grey gravel reads as
 * a road, separates from the warm bank, and does not collide with the mountain
 * spires, which are much paler and stand up.
 */
const ROAD_SURFACE: Record<string, { name: string; color: Color3 }> = {
  dirt: { name: 'roadSurface', color: new Color3(0.62, 0.62, 0.6) },
  dirtDark: { name: 'roadEdge', color: new Color3(0.47, 0.47, 0.46) },
};

function roadRecolour(model: TerrainModel, materialName: string) {
  return model.startsWith('ground_path') ? ROAD_SURFACE[materialName] : undefined;
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
  model: TerrainModel,
  mesh: AbstractMesh,
  shared: Map<string, StandardMaterial>,
): void {
  const source = mesh.material;
  if (!source) return;

  const override = roadRecolour(model, source.name);
  const key = override?.name ?? source.name;

  const existing = shared.get(key);
  if (existing) {
    mesh.material = existing;
    return;
  }

  const flat = new StandardMaterial(`terrain-${key}`, scene);
  flat.diffuseColor =
    override?.color ??
    (source instanceof PBRMaterial ? source.albedoColor.clone() : new Color3(1, 1, 1));
  flat.specularColor = new Color3(0, 0, 0);
  // Keyed by the name merging will group on, which is why an override has to
  // supply one: two colours under one name would merge into whichever won.
  shared.set(key, flat);
  mesh.material = flat;
}
