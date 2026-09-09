// Side effect: registers the .gltf/.glb SceneLoader plugin. The 2.0 entry
// point is deliberate -- it skips the legacy glTF 1.0 loader, and importing
// the package root would pull both.
import '@babylonjs/loaders/glTF/2.0';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { Scene } from '@babylonjs/core/scene';
import type { UnitTypeId } from '@vod/shared';

// Served from `public/`, so these are absolute paths in dev and in the built
// client alike. A Record over UnitTypeId, like every other content table: a new
// unit type is a compile error here rather than a missing mesh at runtime.
const MODEL_URLS: Record<UnitTypeId, string> = {
  infantry: '/models/infantry.gltf',
  cavalry: '/models/cavalry.gltf',
  artillery: '/models/cannon.gltf',
};

export interface UnitModels {
  /** A fresh instance of one unit type's model, parented to a node of ours. */
  instantiate(unitTypeId: UnitTypeId, name: string): TransformNode;
}

/**
 * Loads every unit model once, into containers that stay out of the scene.
 *
 * The models are small and local, but this is still I/O, which is why
 * `createGameRenderer` is async: a renderer whose units have not loaded is not
 * a renderer, and the alternative -- constructing empty and filling in later --
 * gives `snapUnits` and `playEvents` a window where a unit has no mesh.
 */
export async function loadUnitModels(scene: Scene): Promise<UnitModels> {
  const ids = Object.keys(MODEL_URLS) as UnitTypeId[];
  const containers = await Promise.all(
    ids.map((id) => LoadAssetContainerAsync(MODEL_URLS[id], scene)),
  );

  const byType = new Map<UnitTypeId, AssetContainer>(ids.map((id, i) => [id, containers[i]]));

  return {
    instantiate(unitTypeId, name) {
      const container = byType.get(unitTypeId);
      if (!container) throw new Error(`no model for unit type: ${unitTypeId}`);

      // A node of our own, with the loaded model beneath it.
      //
      // Not decoration: the glTF loader puts a `__root__` node above the mesh
      // carrying the right-handed-to-left-handed conversion, which is a
      // negative scale. Setting our facing rotation on *that* node composes
      // with the flip and turns the unit the wrong way. Rotating a parent of
      // it leaves the conversion alone.
      const holder = new TransformNode(name, scene);
      const entries = container.instantiateModelsToScene(
        (source) => `${name}-${source}`,
        // Materials are ours -- one per player colour, assigned by the caller.
        false,
      );
      for (const root of entries.rootNodes) root.parent = holder;
      return holder;
    },
  };
}
