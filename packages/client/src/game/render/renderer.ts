// Side effect: installs scene.stopAnimation, which snapUnits leans on --
// undefined at runtime without it.
import '@babylonjs/core/Animations/animatable';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Coordinate, Facing, GameEvent, GameState, Movement } from '@vod/shared';
import { tileToWorld } from './coordinates';
import { createGridLines } from './gridLines';
import { createTileHighlight, setHighlightTile } from './highlight';
import { createTileOverlay } from './tileOverlay';
import { screenToTile } from './picking';
import { createTerrainMesh } from './terrain';
import { loadTerrainModels } from './terrainModels';
import { animateUnitAlongPath, createUnitMesh, getUnitFacing, setUnitFacing } from './units';
import { loadUnitModels } from './unitModels';

const ORTHO_ZOOM_PADDING = 0.7;

const HOVER_COLOR = new Color3(1, 1, 1);
const HOVER_ALPHA = 0.6;
const HOVER_HEIGHT = 0.02;

const SELECTED_COLOR = new Color3(1, 0.85, 0.1);
const SELECTED_ALPHA = 0.55;
const SELECTED_HEIGHT = 0.025;

// The reachable set, and the route through it to whatever the pointer is
// over. The route sits above the range so it reads on top of it.
const RANGE_COLOR = new Color3(0.3, 0.55, 1);
const RANGE_ALPHA = 0.4;
const RANGE_HEIGHT = 0.015;

const ROUTE_COLOR = new Color3(0.95, 0.98, 1);
const ROUTE_ALPHA = 0.75;
const ROUTE_HEIGHT = 0.018;
// The four tiles a unit may turn to look at. Warm, so it does not read as
// somewhere to go -- by this point movement is already decided.
const FACING_COLOR = new Color3(1, 0.82, 0.35);
const FACING_ALPHA = 0.55;
const FACING_HEIGHT = 0.02;

export interface GameRenderer {
  onTileClick(handler: (coordinate: Coordinate) => void): void;
  setSelectedTile(coordinate: Coordinate | null): void;
  /**
   * The selected unit's movement, or null when nothing is selected. The
   * renderer keeps it so it can draw the route to whatever the pointer is
   * over -- hover never reaches React.
   */
  setMovement(movement: Movement | null): void;
  /**
   * Light the tiles a unit at `around` may turn to look at, or clear them.
   *
   * Takes the centre rather than the four tiles because the grid's bounds live
   * here: a unit on the top row simply has three choices, and nothing outside
   * the renderer needs to know that.
   */
  setFacingChoices(around: Coordinate | null): void;
  /** Animates what the authority says happened. Resolves when done. */
  playEvents(events: GameEvent[]): Promise<void>;
  /**
   * Positions unit meshes from state, no tween -- a no-op after a played
   * animation, the correction after a skipped or failed one. Grows into
   * syncUnits (mesh add/remove) in 8c.
   */
  snapUnits(state: GameState): void;
  /**
   * Walk a unit to a destination it has not actually moved to. Resolves when
   * the preview **settles** -- which is when the walk finishes, but also when
   * a cancel or a snap ends it early. Never left pending: `stopAnimation` does
   * not fire an animation's end callback, so a promise tied to the tween alone
   * would hang and the menu waiting on it would never open.
   */
  previewMove(unitId: string, path: Coordinate[]): Promise<void>;
  /** Put a previewed unit back where it really stands. */
  cancelPreview(): void;
  toggleInspector(): void;
  dispose(): void;
}

// Dev-only: the Inspector UI ships in a separate package, dynamically
// imported here so it's never pulled into a production bundle.
async function toggleInspector(scene: Scene): Promise<void> {
  if (!import.meta.env.DEV) return;

  // scene.debugLayer is itself an augmentation. Loaded inside the guard like
  // the Inspector, so neither ships in a production bundle.
  await import('@babylonjs/core/Debug/debugLayer');
  if (scene.debugLayer.isVisible()) {
    scene.debugLayer.hide();
    return;
  }

  await import('@babylonjs/inspector');
  await scene.debugLayer.show({ embedMode: true });
}

export async function createGameRenderer(
  canvas: HTMLCanvasElement,
  initialState: GameState,
): Promise<GameRenderer> {
  const gridHeight = initialState.grid.length;
  const gridWidth = initialState.grid[0]?.length ?? 0;

  const engine = new Engine(canvas, true);
  const scene = new Scene(engine);

  const camera = new ArcRotateCamera(
    'camera',
    -Math.PI / 2,
    Math.PI / 3.5,
    Math.max(gridWidth, gridHeight),
    Vector3.Zero(),
    scene,
  );
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.attachControl(canvas, true);

  const applyOrthoBounds = (): void => {
    const zoom = Math.max(gridWidth, gridHeight) * ORTHO_ZOOM_PADDING;
    const aspect = canvas.clientWidth / canvas.clientHeight;
    camera.orthoLeft = -zoom * aspect;
    camera.orthoRight = zoom * aspect;
    camera.orthoTop = zoom;
    camera.orthoBottom = -zoom;
  };
  applyOrthoBounds();

  const light = new HemisphericLight('light', new Vector3(0, 1, 0.3), scene);
  light.intensity = 0.9;

  // Awaited alongside the unit models: a board that pops into existence a frame
  // late is a frame nobody needs to see.
  const terrainModels = await loadTerrainModels(scene);
  createTerrainMesh(scene, initialState.grid, terrainModels);
  createGridLines(scene, gridWidth, gridHeight);
  const hoverHighlight = createTileHighlight(scene, 'hover-highlight', HOVER_COLOR, HOVER_ALPHA);
  const selectedHighlight = createTileHighlight(
    scene,
    'selected-highlight',
    SELECTED_COLOR,
    SELECTED_ALPHA,
  );
  const rangeOverlay = createTileOverlay(scene, {
    name: 'movement-range',
    color: RANGE_COLOR,
    alpha: RANGE_ALPHA,
    height: RANGE_HEIGHT,
    gridWidth,
    gridHeight,
  });
  const routeOverlay = createTileOverlay(scene, {
    name: 'movement-route',
    color: ROUTE_COLOR,
    alpha: ROUTE_ALPHA,
    height: ROUTE_HEIGHT,
    gridWidth,
    gridHeight,
  });
  const facingOverlay = createTileOverlay(scene, {
    name: 'facing-choices',
    color: FACING_COLOR,
    alpha: FACING_ALPHA,
    height: FACING_HEIGHT,
    gridWidth,
    gridHeight,
  });

  // Awaited before any unit exists: a renderer whose units are still loading
  // would give snapUnits and playEvents a window in which a unit has no mesh.
  const models = await loadUnitModels(scene);

  const unitMeshes = new Map<string, TransformNode>();
  for (const unit of initialState.units) {
    const owner = initialState.players.find((player) => player.id === unit.owner);
    if (!owner) throw new Error(`unit ${unit.id} has unknown owner ${unit.owner}`);
    unitMeshes.set(
      unit.id,
      createUnitMesh(scene, models, unit, owner.color, gridWidth, gridHeight),
    );
  }

  // The whole ghost: which unit is displaced, where it really stands, and the
  // promise whoever asked for the preview is waiting on.
  interface Preview {
    unitId: string;
    origin: Coordinate;
    facing: Facing;
    settle: () => void;
  }
  let preview: Preview | null = null;

  // Arriving and ending are different moments, and conflating them loses the
  // origin: the record has to outlive the walk, because a Cancel *after* the
  // unit lands is exactly when something needs to know where to put it back.
  const arrivePreview = (): void => {
    preview?.settle();
  };

  const endPreview = (): void => {
    if (!preview) return;
    // Stopping matters as much as settling: a preview ended mid-walk would
    // otherwise leave its tween writing positions over whatever replaced it,
    // and a second preview of the same unit would run two walks on one mesh.
    const mesh = unitMeshes.get(preview.unitId);
    if (mesh) scene.stopAnimation(mesh);

    preview.settle();
    preview = null;
  };

  // Tiles are 1.0 apart, so this only has to beat float drift off a finished
  // tween, not distinguish anything close together.
  const TILE_EPSILON = 0.01;

  const isStandingOn = (mesh: TransformNode, coordinate: Coordinate): boolean => {
    const target = tileToWorld(coordinate, gridWidth, gridHeight);
    return (
      Math.abs(mesh.position.x - target.x) < TILE_EPSILON &&
      Math.abs(mesh.position.z - target.z) < TILE_EPSILON
    );
  };

  const hoveredCoordinate = (): Coordinate | null =>
    screenToTile(scene, camera, scene.pointerX, scene.pointerY, gridWidth, gridHeight);

  // The route is recomputed only when the pointer crosses into a different
  // tile, not on every mouse event.
  let movement: Movement | null = null;
  let hoveredKey: string | null = null;

  const showRouteTo = (coordinate: Coordinate | null): void => {
    if (!movement || !coordinate) return routeOverlay.setTiles([]);
    // `pathTo` answers for any settled tile, including ones occupied by a
    // friendly unit that nobody may stop on. Only draw a route somewhere the
    // unit could actually end up.
    const reachable = movement.reachable.some(
      (tile) => tile.col === coordinate.col && tile.row === coordinate.row,
    );
    routeOverlay.setTiles(reachable ? (movement.pathTo(coordinate) ?? []) : []);
  };

  let clickHandler: ((coordinate: Coordinate) => void) | null = null;
  scene.onPointerObservable.add((pointerInfo) => {
    if (pointerInfo.type === PointerEventTypes.POINTERMOVE) {
      const coordinate = hoveredCoordinate();
      setHighlightTile(hoverHighlight, coordinate, HOVER_HEIGHT, gridWidth, gridHeight);

      const key = coordinate ? `${coordinate.col},${coordinate.row}` : null;
      if (key !== hoveredKey) {
        hoveredKey = key;
        showRouteTo(coordinate);
      }
      return;
    }

    if (pointerInfo.type === PointerEventTypes.POINTERPICK && clickHandler) {
      const coordinate = hoveredCoordinate();
      if (coordinate) clickHandler(coordinate);
    }
  });

  engine.runRenderLoop(() => {
    scene.render();
  });

  const handleResize = (): void => {
    engine.resize();
    applyOrthoBounds();
  };
  window.addEventListener('resize', handleResize);

  return {
    onTileClick(handler) {
      clickHandler = handler;
    },
    setSelectedTile(coordinate) {
      setHighlightTile(selectedHighlight, coordinate, SELECTED_HEIGHT, gridWidth, gridHeight);
    },
    setFacingChoices(around) {
      if (!around) {
        facingOverlay.setTiles([]);
        return;
      }
      const neighbours = [
        { col: around.col, row: around.row + 1 },
        { col: around.col, row: around.row - 1 },
        { col: around.col + 1, row: around.row },
        { col: around.col - 1, row: around.row },
      ];
      facingOverlay.setTiles(
        neighbours.filter(
          ({ col, row }) => col >= 0 && row >= 0 && col < gridWidth && row < gridHeight,
        ),
      );
    },
    setMovement(next) {
      movement = next;
      rangeOverlay.setTiles(next?.reachable ?? []);
      // The selection changed under the pointer, so the route it was showing
      // may no longer apply.
      showRouteTo(next ? hoveredCoordinate() : null);
    },
    async playEvents(events) {
      for (const event of events) {
        if (event.type !== 'unitMoved') continue;
        const mesh = unitMeshes.get(event.unitId);
        if (!mesh) continue;

        // Already shown. A confirmed preview has walked this unit here
        // already, so replaying the move would send it back to the second
        // tile and forward again. Positional rather than a flag: if the mesh
        // is where the event says it ends, the move has been seen. Safe
        // because the menu only opens once the walk has arrived.
        const destination = event.path[event.path.length - 1];
        if (isStandingOn(mesh, destination)) continue;

        await animateUnitAlongPath(mesh, event.path, gridWidth, gridHeight, scene);
      }
    },
    previewMove(unitId, path) {
      endPreview();
      const mesh = unitMeshes.get(unitId);
      if (!mesh) return Promise.resolve();

      let settle!: () => void;
      const settled = new Promise<void>((resolve) => (settle = resolve));
      preview = { unitId, origin: path[0], facing: getUnitFacing(mesh), settle };

      void animateUnitAlongPath(mesh, path, gridWidth, gridHeight, scene).then(() => {
        // Only if this preview is still the live one -- a cancel or a snap
        // may have ended it while the walk was running.
        if (preview?.settle === settle) arrivePreview();
      });
      return settled;
    },
    cancelPreview() {
      const previewed = preview;
      if (!previewed) return;

      const mesh = unitMeshes.get(previewed.unitId);
      if (mesh) {
        // Stop first: a cancel mid-walk must win over the tween still writing
        // positions, exactly as a snap does.
        scene.stopAnimation(mesh);
        const home = tileToWorld(previewed.origin, gridWidth, gridHeight);
        mesh.position.set(home.x, mesh.position.y, home.z);
        setUnitFacing(mesh, previewed.facing);
      }
      endPreview();
    },
    snapUnits(state) {
      // Authority overwrites every position, the previewed one included, so
      // this *is* the preview ending -- there is no separate commit.
      endPreview();
      for (const unit of state.units) {
        const mesh = unitMeshes.get(unit.id);
        if (!mesh) continue;
        // Stop first: a snap must win over any tween still writing positions.
        scene.stopAnimation(mesh);
        const target = tileToWorld(unit.position, gridWidth, gridHeight);
        mesh.position.set(target.x, mesh.position.y, target.z);
        setUnitFacing(mesh, unit.facing);
      }
    },
    toggleInspector() {
      void toggleInspector(scene);
    },
    dispose() {
      window.removeEventListener('resize', handleResize);
      engine.dispose();
    },
  };
}
