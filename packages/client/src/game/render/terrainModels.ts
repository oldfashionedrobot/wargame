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

// Kenney's Nature Kit, CC0. Every ground model is exactly 1x1 in x and z, which
// is TILE_SIZE, so the board needs no scaling. Their tops are *not* all level
// and nothing here assumes they are: grass and every riverbank sit at -0.05,
// open water at -0.10 with no bank to speak of, and a stone pad at 0.20. That
// is what `topOf` is for.
//
// ⚠️ Those numbers do not match the position accessors, because every model in
// the kit hangs under a node translated -0.05 in y. Reading the raw geometry
// gives answers a uniform 0.05 too high -- which is exactly the kind of thing
// measuring the loaded meshes gets right for free and a transcribed table does
// not. See the licence alongside them in public/models/terrain/.
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
  // A stone pad, the only ground that stands above the rest of the board. It
  // measures 0.20 against a MAX_STAND_HEIGHT of 0.25, so the kit's half-height
  // cliff beside it is *not* a drop-in -- see `topOf`.
  'cliff_blockQuarter_stone',
  // Things that stand on the ground rather than being it.
  'bridge_wood',
  'tree_default',
  // Loose stone, scattered over a peak. Ground clutter and nothing taller --
  // the pad is what makes a mountain read as raised, so these only have to
  // make it read as rocky. All `stone`, so they merge into the pad's own
  // material however many end up on a tile.
  'stone_smallA',
  'stone_smallB',
  'stone_smallC',
  'stone_smallE',
  'stone_smallI',
  'stone_smallFlatB',
] as const;

export type TerrainModel = (typeof TERRAIN_MODELS)[number];

export interface TerrainModels {
  /**
   * How high the top of a ground model sits, measured from its geometry.
   *
   * ⚠️ **Measured, never declared.** A tile's walkable surface *is* the top of
   * the model drawn there, so deriving it means there is no second number to
   * drift out of step with the art -- swap the model and the height follows.
   * The same discipline as `entryCost` being the only cost model.
   *
   * ⚠️ Bounded by `MAX_STAND_HEIGHT`, which explains why; `warnIfTooTall` is
   * what checks it, since the answer is not knowable until these are loaded.
   */
  topOf(model: TerrainModel): number;
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

  const tops = new Map<TerrainModel, number>(
    TERRAIN_MODELS.map((model, i) => {
      const ys = containers[i].meshes
        .filter((mesh) => mesh.getTotalVertices() > 0)
        .map((mesh) => mesh.getBoundingInfo().boundingBox.maximumWorld.y);
      return [model, ys.length > 0 ? Math.max(...ys) : 0];
    }),
  );
  const sharedMaterials = new Map<string, StandardMaterial>();

  return {
    topOf(model) {
      return tops.get(model) ?? 0;
    },
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
 * Repaints, by the prefix of the models they apply to and the material they
 * replace. The kit reuses a handful of materials across everything it ships,
 * which twice now has made two kinds of tile the same object on the board.
 * Recolouring is the answer both times: the *shapes* were never the problem.
 *
 * ⚠️ An entry supplies a **name** as well as a colour, because merging groups
 * meshes by material name. Two colours sharing one name would merge into
 * whichever happened to win.
 *
 * - **Roads** are painted `dirt`/`dirtDark`, the same two a riverbank is, which
 *   left a road and a river near enough identical — one just had water down the
 *   middle. A cool grey gravel separates it from the warm bank.
 * - **A peak's pad** is topped with `grass`, so a mountain read as a lawn with
 *   pebbles on it: the same green as the plains beside it, distinguishable only
 *   by the rubble. A dark slate makes the tile itself say *rock*, and it is
 *   darker than the pale `stone` of the rubble and the pad's own sides on
 *   purpose — that is the contrast the scatter reads against.
 */
const RECOLOUR: Record<string, Record<string, { name: string; color: Color3 }>> = {
  ground_path: {
    dirt: { name: 'roadSurface', color: new Color3(0.62, 0.62, 0.6) },
    dirtDark: { name: 'roadEdge', color: new Color3(0.47, 0.47, 0.46) },
  },
  cliff_: {
    grass: { name: 'cliffTop', color: new Color3(0.44, 0.52, 0.56) },
  },
};

function recolour(model: TerrainModel, materialName: string) {
  for (const prefix in RECOLOUR) {
    if (model.startsWith(prefix)) return RECOLOUR[prefix][materialName];
  }
  return undefined;
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
 *
 * ⚠️ **This carries a colour and nothing else**, which is only safe because
 * every model in this kit paints itself with flat colours. A *textured* model
 * dropped in here loses its texture and takes `albedoColor` instead — and a
 * glTF that paints by texture usually has no `baseColorFactor` at all, so the
 * colour is white and the board goes blank. That is the same symptom as the
 * metallic bug above and a different cause, which is exactly why it is worth
 * saying out loud rather than diagnosing twice. Established on a spike that
 * swapped in a texture-atlas kit, not imagined.
 */
function shareMaterial(
  scene: Scene,
  model: TerrainModel,
  mesh: AbstractMesh,
  shared: Map<string, StandardMaterial>,
): void {
  const source = mesh.material;
  if (!source) return;

  const override = recolour(model, source.name);
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
  // Says so rather than rendering a mystery. Nothing in this kit is textured,
  // so reaching here means a model arrived that does not belong to it.
  if (source instanceof PBRMaterial && source.albedoTexture && !override) {
    console.error(
      `terrain: ${model}'s "${source.name}" is textured, and this keeps only a ` +
        `colour — it will draw flat, and blank if the material has no base colour`,
    );
  }
  // Keyed by the name merging will group on, which is why an override has to
  // supply one: two colours under one name would merge into whichever won.
  shared.set(key, flat);
  mesh.material = flat;
}
