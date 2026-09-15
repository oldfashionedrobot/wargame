import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import type { Scene } from '@babylonjs/core/scene';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Facing, PlayerColor, Unit } from '@vod/shared';

import type { TerrainCell } from './composeTerrain';
import { createTerrainMesh } from './terrain';
import type { TerrainModels } from './terrainModels';
import { createUnitMesh } from './units';
import type { UnitModels } from './unitModels';

/**
 * Where the staged views are built, far enough from the board that the board's
 * own camera can never see them and theirs can never see it.
 *
 * ⚠️ **Two positions, not one**, because the views are *separate*. Two units
 * five tiles apart do not belong in one framed space -- every attempt to stage
 * them together ends in a compromise about distance -- so each combatant gets
 * its own camera looking at its own patch, and nothing has to frame a pair.
 */
const STAGE_A = new Vector3(600, 0, 0);
const STAGE_B = new Vector3(700, 0, 0);

/**
 * Air left around the staged pair, as a fraction of its own height.
 *
 * ⚠️ **The only number here, because the rest is measured.** An earlier pass
 * carried a fixed view extent and a guessed figure centre, and both were wrong
 * in a browser -- first a thumbnail adrift in its half of the band, then a
 * figure sunk to the floor with dead air above it. Framing what was actually
 * built is the same discipline `topOf` already uses: measure the model rather
 * than declare a number beside it.
 */
const STAGE_MARGIN = 0.35;

/**
 * The share of each view kept clear at the bottom, for the readout printed over
 * it.
 *
 * ⚠️ **Reserved in the *camera*, not left to the layout.** The figures are framed
 * to fill their views, so any bar placed inside the band crosses their feet and
 * any bar placed below it lands on the strip of board the band does not cover.
 * Shrinking what the camera frames is the only version where the two cannot
 * collide.
 */
const READOUT_SHARE = 0.25;

/**
 * ⚠️ Shallower than the board's camera, and deliberately. The board is read
 * from above because it is a map; a combatant is read from nearer eye level
 * because it is a figure.
 */
const STAGE_BETA = Math.PI / 2.6;

/** Dark enough to read as "the board is not what you are looking at". */
const BACKDROP = new Color3(0.09, 0.1, 0.14);

/** The band the two views occupy, in normalised viewport units from the bottom. */
const BAND_BOTTOM = 0.3;
const BAND_HEIGHT = 0.4;

export interface Combatant {
  unitTypeId: Unit['unitTypeId'];
  color: PlayerColor;
  facing: Facing;
  /** The cell this unit is standing on, taken from the board's own composition. */
  cell: TerrainCell;
}

export interface Cutaway {
  /** Build and reveal the two views. Replaces whatever was shown. */
  show(attacker: Combatant, defender: Combatant): void;
  /** Tear the views down and give the canvas back to the board. */
  hide(): void;
}

/**
 * The staged half of the combat cutaway: two close-ups, drawn over the board.
 *
 * ⚠️ **A second camera, not a second scene and not the board's camera moved.**
 * A second scene would load every unit model again, `loadUnitModels` binding its
 * container to a scene. Moving the board's camera would fight three things at
 * once -- its radius is locked, its tilt is clamped, and `holdTheBoard`
 * re-clamps the target every frame -- and then have to restore all three
 * exactly. Two extra cameras avoid all of it, which makes the bigger-sounding
 * option the smaller one.
 *
 * ⚠️ **The board's own camera never gets a viewport.** `holdTheBoard` sizes its
 * ortho extents from `canvas.clientWidth / clientHeight` every frame, so a
 * viewport would leave the board fitted to a shape nobody is drawing. These are
 * drawn *over* the full-canvas board instead.
 *
 * ⚠️ **Built on show and torn down on hide**, rather than kept and reused. A
 * battle is a second and a half and the models come from containers that are
 * already loaded, so instantiating two of them is a call rather than a load --
 * and keeping them would mean caching by unit type and colour, which is state to
 * get wrong for no saving worth having.
 */
export function createCutaway(
  scene: Scene,
  unitModels: UnitModels,
  terrainModels: TerrainModels,
  boardCamera: Camera,
): Cutaway {
  const views = [
    stage(STAGE_A, new Viewport(0, BAND_BOTTOM, 0.5, BAND_HEIGHT)),
    stage(STAGE_B, new Viewport(0.5, BAND_BOTTOM, 0.5, BAND_HEIGHT)),
  ];

  function stage(at: Vector3, viewport: Viewport) {
    const camera = new ArcRotateCamera(
      `cutaway-${at.x}`,
      // Looking down the +z axis at the figure's front, which is where
      // `setUnitFacing`'s north points.
      Math.PI / 2,
      STAGE_BETA,
      20,
      at,
      scene,
    );
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    camera.viewport = viewport;

    // ⚠️ **A backdrop, because otherwise the board shows through and the whole
    // thing reads as two figures floating over the map rather than a view that
    // took over.** It is geometry rather than a DOM layer for the obvious
    // reason: the staged models are drawn by Babylon, so anything meant to sit
    // *behind* them has to be in the scene too.
    const backdrop = CreatePlane(`cutaway-backdrop-${at.x}`, { size: 40 }, scene);
    backdrop.position.copyFrom(at);
    // Always square to whoever is looking, so the angle never has to be kept in
    // step with the camera's.
    backdrop.billboardMode = Mesh.BILLBOARDMODE_ALL;
    backdrop.isPickable = false;
    const dark = new StandardMaterial(`cutaway-backdrop-material-${at.x}`, scene);
    dark.diffuseColor = BACKDROP;
    dark.emissiveColor = BACKDROP;
    dark.disableLighting = true;
    backdrop.material = dark;
    backdrop.setEnabled(false);
    // ⚠️ No `attachControl`. These are not cameras anyone drives, and attaching
    // would put two controllers on one canvas.
    return { at, camera, backdrop, built: [] as TransformNode[] };
  }

  const clearBuilt = (): void => {
    for (const view of views) {
      for (const node of view.built) node.dispose(false, false);
      view.built = [];
      view.backdrop.setEnabled(false);
    }
  };

  const build = (view: (typeof views)[number], who: Combatant): void => {
    // ⚠️ One tile, and it is a *representation* rather than a window onto the
    // board: it says "this unit is in forest", so it needs no neighbours, no
    // road continuation and no slice of the real grid. `createTerrainMesh` takes
    // a cells array, so one tile is the same call with a smaller argument -- and
    // it builds the cell's props, so a wood arrives with its own trees.
    const ground = createTerrainMesh(scene, terrainModels, [[who.cell]]);
    ground.position.copyFrom(view.at);
    view.built.push(ground);

    // ⚠️ Built through `createUnitMesh` and then moved, rather than
    // reconstructed here. That function owns the material, the per-type scale
    // and the facing rotation; duplicating any of them is how a cutaway comes to
    // show a differently sized piece than the board does.
    const stub: Unit = {
      id: `cutaway-${view.at.x}`,
      position: { col: 0, row: 0 },
      facing: who.facing,
      unitTypeId: who.unitTypeId,
      owner: 'cutaway',
      health: 100,
      hasActed: false,
    };
    const unit = createUnitMesh(scene, unitModels, stub, who.color, () => 0, 1, 1);
    unit.position.set(view.at.x, view.at.y + terrainModels.topOf(who.cell.ground), view.at.z);
    view.built.push(unit);
  };

  /**
   * Point the camera at what was built and size it to fit.
   *
   * ⚠️ **Measured from the meshes, never from constants.** A figure stands *on*
   * its tile, so its centre is neither the tile's height nor a guess about the
   * model -- and the two unit types are different heights anyway. Asking the
   * hierarchy means a new model or a changed scale needs nothing here.
   */
  const frame = (view: (typeof views)[number]): void => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const node of view.built) {
      const bounds = node.getHierarchyBoundingVectors();
      min = Math.min(min, bounds.min.y);
      max = Math.max(max, bounds.max.y);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;

    // The figure occupies the top `1 - READOUT_SHARE` of the view, so it spans
    // `1.5 × extent` of the viewport's full `2 × extent` -- which fixes both the
    // extent and how far the target sits below the figure's own centre.
    const height = Math.max(max - min, 0.1);
    const extent = ((height / (2 - READOUT_SHARE * 2)) * (1 + STAGE_MARGIN)) / 1;
    const centre = (min + max) / 2;
    view.camera.setTarget(new Vector3(view.at.x, centre - extent * READOUT_SHARE, view.at.z));
    view.backdrop.position.copyFrom(view.camera.getTarget());

    const engine = scene.getEngine();
    const aspect = (engine.getRenderWidth() * 0.5) / (engine.getRenderHeight() * BAND_HEIGHT);
    view.camera.orthoTop = extent;
    view.camera.orthoBottom = -extent;
    view.camera.orthoLeft = -extent * aspect;
    view.camera.orthoRight = extent * aspect;
  };

  return {
    show(attacker, defender) {
      clearBuilt();
      build(views[0], attacker);
      build(views[1], defender);
      for (const view of views) {
        view.backdrop.setEnabled(true);
        frame(view);
      }
      // ⚠️ The board stays first and keeps the whole canvas; these draw over it.
      scene.activeCameras = [boardCamera, views[0].camera, views[1].camera];
    },
    hide() {
      clearBuilt();
      scene.activeCameras = [boardCamera];
    },
  };
}
