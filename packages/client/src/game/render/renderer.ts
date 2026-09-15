// Side effect: installs scene.stopAnimation, which syncUnits leans on --
// undefined at runtime without it.
import '@babylonjs/core/Animations/animatable';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type {
  AttackKind,
  BattleResolvedEvent,
  Coordinate,
  Facing,
  GameEvent,
  GameState,
  PlayerColor,
  UnitTypeId,
} from '@vod/shared';
import { getTerrain } from '@vod/shared';
import { tileToWorld } from './coordinates';
import { createGridLines } from './gridLines';
import { createCutaway } from './cutaway';
import { createTileHighlight, setHighlightTile } from './highlight';
import { createHealthRing } from './healthRing';
import type { HealthRing } from './healthRing';
import { createRouteArrow } from './routeArrow';
import { createTileOverlay } from './tileOverlay';
import { screenToTile } from './picking';
import { createTerrainMesh } from './terrain';
import { createBoardBase } from './boardBase';
import { MAX_STAND_HEIGHT, composeTerrain } from './composeTerrain';
import type { TerrainCell } from './composeTerrain';
import { loadTerrainModels } from './terrainModels';
import type { TerrainModel } from './terrainModels';
import { animateUnitAlongPath, createUnitMesh, getUnitFacing, setUnitFacing } from './units';
import { loadUnitModels } from './unitModels';

/**
 * Zoom, as a multiple of the distance at which the whole board just fits.
 *
 * ⚠️ **`MIN_ZOOM` of 1 is the floor for a reason, not a taste.** Below it the
 * board stops filling the viewport and the wheel buys nothing but background.
 * The fit it is a multiple *of* is measured at the current camera angle rather
 * than derived from the grid -- see `fitExtent`.
 *
 * ⚠️ **`DEFAULT_ZOOM` sits at the floor, and that was not the first answer.**
 * Going to 20x20 appeared to leave pieces unreadable whole-board, so this began
 * at 2.2 -- which put the camera on the middle of the board with neither army
 * in frame, and was worse. The appearance came from judging a *cropped and
 * downscaled* screenshot rather than the viewport: at full size the fit reads
 * perfectly well, and starting anywhere else is starting somewhere the player
 * did not ask to be. Zoom in for detail; the board is the view.
 */
const MIN_ZOOM = 1;
const MAX_ZOOM = 3.5;
const DEFAULT_ZOOM = MIN_ZOOM;
const ZOOM_PER_NOTCH = 1.12;
/** A hair of air around the board at full zoom-out, so it is not flush. */
const FIT_MARGIN = 1.04;

/**
 * How far the camera may tilt, and what the band costs at each end.
 *
 * Orbit stays free in `alpha` — facing and flanking are mechanics here, and a
 * unit's rear is only a target you can aim at if you can go round and look at
 * it. Only `beta` is clamped, and until this existed it had **no limits at all**:
 * a drag could take the camera anywhere, including angles no constant on the
 * board had been chosen against.
 *
 * ⚠️ **The shallow end is a judgement, not arithmetic** — worth saying plainly,
 * because it reads like arithmetic. A surface of height `h` draws `h / tan θ`
 * tiles up-screen, so the mesa (0.479, the tallest thing a unit stands on)
 * covers 0.60 of the tile behind it at the starting angle and **0.83 at 30°**.
 * That is the whole price. It is not a *picking* price: `screenToTile` searches
 * every surface height tallest-first, so a click finds a peak wherever it is
 * drawn however shallow the view. What degrades is only how much board a raised
 * tile hides, and that is a thing to look at rather than solve.
 *
 * ⚠️ There is more room here than there looks, and the reason is the trees. The
 * bound was first drawn at 38.66° against `MAX_STAND_HEIGHT`, while the tallest
 * thing actually on the board was a tree at **1.96** — occluding two and a half
 * tiles and governed by nothing. At today's scale the tallest is 0.79, so the
 * shallow view costs less now than the steep one used to.
 *
 * The top-down end stays free of all this: tilting *up* only ever shortens what
 * a prop covers, so 60° is a view limit rather than a legibility one.
 */
const CAMERA_BETA = Math.PI / 3.5; // start: 38.57° above the horizon
const CAMERA_BETA_TOPDOWN = Math.PI / 6; // 60° above the horizon — nearly overhead
const CAMERA_BETA_SHALLOW = Math.PI / 3; // 30° above the horizon

const HOVER_COLOR = new Color3(1, 1, 1);
const HOVER_ALPHA = 0.6;
const HOVER_HEIGHT = 0.02;

const SELECTED_COLOR = new Color3(1, 0.85, 0.1);
/** How long a cutaway holds before handing the canvas back. */
const CUTAWAY_MS = 1500;

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

/**
 * ⚠️ **Opaque where every other overlay is a wash, and the board is why.**
 * Red and this teal ground are near-complementary, so blending them gives
 * *grey* rather than pink: a desaturated red at 0.34 was invisible, and even a
 * strong red at 0.4 read as a slightly dirty tile. The pale blue range and amber
 * facing tints survive at 0.4-0.55 because neither fights the ground that way.
 * At 0.8 it reads as a salmon band and terrain is still legible underneath,
 * which is what a player is evaluating.
 *
 * It sits below `FACING_HEIGHT` deliberately -- but the two sets never overlap,
 * because the four tiles beside the unit are filtered out of the attack band in
 * `selection.ts`. The ordering is insurance, not the rule.
 */
const ATTACK_COLOR = new Color3(0.95, 0.2, 0.24);
const ATTACK_ALPHA = 0.8;
const ATTACK_HEIGHT = 0.016;
// ⚠️ **A deeper red than the shooting band, not a different hue.** A charge is
// an attack, so it should read as one at a glance; what it must not do is read
// as *the same* attack, because the two are never offered together and a player
// arriving at a lit board needs to know which question is being asked. Same
// alpha and height for the same reason the attack band needed 0.8 -- red over
// this teal ground blends toward grey at anything less.
const CHARGE_COLOR = new Color3(0.62, 0.08, 0.12);
const CHARGE_ALPHA = 0.8;
const CHARGE_HEIGHT = 0.016;
const FACING_ALPHA = 0.55;
const FACING_HEIGHT = 0.02;

/**
 * What a cutaway is showing, for the DOM half to print over it.
 *
 * ⚠️ **Both healths, before and after**, because a bar counting down needs the
 * value it counts *from* and `battleResolved` carries only results (invariant
 * 9). The before-value comes from `lastDrawn()` -- the queue animates before it
 * snaps, so mid-cutaway the last sync is still the previous turn.
 */
export interface CutawaySide {
  unitTypeId: UnitTypeId;
  color: PlayerColor;
  before: number;
  after: number;
  /** The defence the terrain under this unit is worth. */
  defense: number;
}

export interface CutawayScene {
  /**
   * Which battle this is, counting up.
   *
   * ⚠️ Carried so the DOM half can *remount* per battle rather than mutate. A
   * health bar that animates has to start at the before-value, and a component
   * that persists across battles would have to correct itself after mounting --
   * which is a synchronous `setState` in an effect, and a cascading render.
   * Nothing else reads it.
   */
  id: number;
  kind: AttackKind;
  attacker: CutawaySide;
  defender: CutawaySide;
}

export interface GameRenderer {
  onTileClick(handler: (coordinate: Coordinate) => void): void;
  setSelectedTile(coordinate: Coordinate | null): void;
  /** Light the tiles a selected unit may reach, or clear them. */
  setRange(tiles: Coordinate[]): void;
  /**
   * Light what an arrived unit can shoot at, or clear it.
   *
   * ⚠️ The **band**, not the targets: red means *in range*. Which tiles those
   * are -- and how the four beside the unit are split between this and
   * `setFacingChoices` -- is decided in `selection.ts`, where the board is.
   */
  setAttackRange(tiles: Coordinate[]): void;
  /**
   * Light the tiles a unit may charge, or clear them.
   *
   * ⚠️ **Targets, not reach.** Unlike the shooting band, which shows *range*,
   * every tile lit here is one a charge could actually be launched at -- a
   * charge is contact-only, so there is no reach to communicate and an
   * unclickable lit tile would promise nothing.
   */
  setChargeTargets(tiles: Coordinate[]): void;
  /**
   * Draw a pinned route, or clear it.
   *
   * ⚠️ Coordinates, not a `Movement`. The renderer used to hold the search
   * itself so it could answer `POINTERMOVE` without troubling React -- which
   * meant the route existed only under a pointer, and a touchscreen never saw
   * one at all. Presentation is given tiles to light, not a search to query.
   */
  setRoute(path: Coordinate[]): void;
  /**
   * Keep `element` positioned over `coordinate`, or stop.
   *
   * ⚠️ The renderer writes `transform` rather than React re-rendering: a DOM
   * overlay tracking the board is otherwise a React commit every frame the
   * camera turns. React owns the content, this owns the placement.
   */
  anchorTo(element: HTMLElement | null, coordinate: Coordinate | null): void;
  /**
   * Light the tiles a unit may turn to look at, or clear them.
   *
   * ⚠️ Takes tiles, like every other overlay setter. It used to take the centre
   * and derive the four itself, which put a question about the *selection* --
   * which tiles mean something -- inside the thing that paints. Clipping to the
   * board went with it to `selection.ts`, where it is testable; nothing in here
   * has unit tests, being WebGL.
   */
  setFacingChoices(tiles: Coordinate[]): void;
  /** Animates what the authority says happened. Resolves when done. */
  playEvents(events: GameEvent[]): Promise<void>;
  /**
   * Makes the meshes match `state`: the dead are removed, the living are
   * positioned, no tween. A no-op after a played animation, the correction
   * after a skipped or failed one.
   *
   * ⚠️ **Removal only, never creation, and that is not an oversight.** Nothing
   * can add a unit to a match: `applyEvents` only ever maps over `units`, and
   * there is no production, no reinforcement and no recruitment. Units enter
   * state once, in `createMatchState`, before this renderer is built. If that
   * ever changes, the other half goes here.
   */
  syncUnits(state: GameState): void;
  /**
   * The state this renderer last drew.
   *
   * ⚠️ **Which is the state *before* whatever `playEvents` is about to animate**,
   * and that is the whole reason it exists. The queue awaits `playEvents` and
   * only then calls `syncUnits`, so during an animation the last sync is still
   * the previous turn -- which is where a damage animation gets the health it is
   * counting down *from*. `battleResolved` carries only resulting values
   * (invariant 9), so the before-value is nowhere else.
   *
   * ⚠️ **Not a second source of truth.** It is a record of what was drawn, not an
   * opinion about what is true; `syncUnits` is still the only thing that moves
   * it, and every reader wanting authority reads `server.getState()` as before.
   */
  lastDrawn(): GameState;
  /**
   * Called when a battle's cutaway opens and closes, with what to print over it.
   *
   * ⚠️ **The staged models are Babylon's; the numbers are React's.** Health bars
   * and figures want text, layout and transitions, which is DOM's job and not
   * something to rebuild in a 3D scene. So the renderer raises the views and
   * hands the caller everything it would otherwise have had to re-derive.
   */
  onCutaway(handler: (scene: CutawayScene | null) => void): void;
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

/**
 * Shouts if any tile's walkable surface is higher than picking can absorb.
 *
 * ⚠️ Checks the **surface**, not the ground model, because that is what
 * `MAX_STAND_HEIGHT` governs. Testing `topOf` alone and `standOn` alone passes
 * a cell that breaches the ceiling on their sum — a deck on a raised pad is
 * only ever one map away, and each half would look innocent.
 *
 * The way this gets breached is a model swap — the kit has a half-height cliff
 * sitting right beside the quarter-height one — and the symptom is not a raised
 * tile but *clicks landing on the neighbour*, which nobody would trace back to
 * the art. Heights are measured at load, so this is the earliest point anything
 * can know. A warning rather than a throw: the board still draws, and the
 * browser is this renderer's only check anyway.
 */
function warnIfTooTall(cells: TerrainCell[][], surfaceAt: (at: Coordinate) => number): void {
  // One complaint per offending ground, not per tile: a range of mountains
  // would otherwise say the same thing thirty times.
  const tall = new Map<TerrainModel, number>();
  cells.forEach((cellRow, row) =>
    cellRow.forEach((cell, col) => {
      const surface = surfaceAt({ col, row });
      if (surface > MAX_STAND_HEIGHT) tall.set(cell.ground, surface);
    }),
  );

  for (const [ground, surface] of tall) {
    console.error(
      `terrain: a ${ground} tile stands at ${surface.toFixed(2)}, over the ` +
        `${MAX_STAND_HEIGHT} a tile may be before clicks land on the wrong one`,
    );
  }
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
    CAMERA_BETA,
    Math.max(gridWidth, gridHeight),
    Vector3.Zero(),
    scene,
  );
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.attachControl(canvas, true);

  // ⚠️ An orthographic camera's apparent size comes entirely from its ortho
  // bounds; `radius` changes nothing you can see. So the wheel's default job --
  // moving the camera along its radius -- is not zoom here, it is walking the
  // camera into the board until the near plane starts eating it. Take the
  // input away and drive the bounds instead.
  camera.inputs.removeByType('ArcRotateCameraMouseWheelInput');
  // Pinned, so nothing else can drift it, and far enough out that orbiting
  // never brings a corner of the board through the near plane.
  camera.lowerRadiusLimit = camera.radius;
  camera.upperRadiusLimit = camera.radius;
  // Rotation stays free; only the tilt is bounded. The camera starts partway up
  // its own band rather than at an end of it — see CAMERA_BETA above for what
  // each end costs.
  camera.lowerBetaLimit = CAMERA_BETA_TOPDOWN;
  camera.upperBetaLimit = CAMERA_BETA_SHALLOW;
  camera.minZ = 0.1;

  let zoom = DEFAULT_ZOOM;

  const handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const scale = event.deltaY < 0 ? ZOOM_PER_NOTCH : 1 / ZOOM_PER_NOTCH;
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * scale));
  };
  canvas.addEventListener('wheel', handleWheel, { passive: false });

  const light = new HemisphericLight('light', new Vector3(0, 1, 0.3), scene);
  light.intensity = 0.9;
  // ⚠️ Not the default black. `groundColor` is what a surface facing *away*
  // from the light receives, and at zero anything vertical goes to nothing.
  // That was invisible while the board was flat-topped tiles; it is not once
  // things stand up on them -- a grass blade turned away rendered at #23361c
  // against ground at #27bea2, which reads as dirt rather than as a plant.
  light.groundColor = new Color3(0.42, 0.44, 0.42);

  // Awaited alongside the unit models: a board that pops into existence a frame
  // late is a frame nobody needs to see.
  const terrainModels = await loadTerrainModels(scene);
  const cells = composeTerrain(initialState.grid);

  /**
   * How high a unit stands on a tile — **the only answer to that question**.
   *
   * Terrain, props, units, the walk animation and all five overlays go through
   * here, so there is no second way to ask and nothing to drift. The ground's
   * share is measured off the model rather than declared; `standOn` adds the
   * one case where you stand on a prop instead, a bridge deck.
   */
  const surfaceAt = ({ col, row }: Coordinate): number => {
    const cell = cells[row]?.[col];
    if (!cell) return 0;

    const ground = terrainModels.topOf(cell.ground);
    // Standing on top of a prop measures the prop; standing partway up one has
    // to be told. Scale multiplies the measurement, since the prop carries it.
    const onProp = cell.standOnProp === undefined ? undefined : cell.props[cell.standOnProp];
    if (onProp) return ground + terrainModels.topOf(onProp.model) * onProp.scale;

    return ground + (cell.standOn ?? 0);
  };

  /**
   * Every distinct height a tile's surface sits at, tallest first.
   *
   * This is what lets `screenToTile` find a raised tile where it is *drawn*
   * rather than where it would fall onto a flat board. Worked out once: terrain
   * does not change during a match, and a board has two or three of these.
   */
  const levels = [
    ...new Set(cells.flatMap((cellRow, row) => cellRow.map((_, col) => surfaceAt({ col, row })))),
  ].sort((a, b) => b - a);

  warnIfTooTall(cells, surfaceAt);

  createTerrainMesh(scene, terrainModels, cells);
  // The board's floor, which every tile shares -- a mountain raises a rock, not
  // its ground. Taken from the models rather than assumed to be zero.
  const groundLevel = Math.max(...cells.flat().map((cell) => terrainModels.topOf(cell.ground)));
  createGridLines(scene, groundLevel, gridWidth, gridHeight);
  // Under the floor, so the board is an object rather than geometry that stops.
  // Nothing reads it: it is not pickable and `surfaceAt` does not know it.
  //
  // ⚠️ `bottomOf`, not `topOf`. The grid lines take the highest *top* because
  // they go over everything; a slab has to clear the lowest *geometry*, which
  // is a different question -- a river is a channel cut into its tile, so its
  // top is the bank at 0.00 while the water it has to stay under is at -0.05.
  // Measuring the top here hangs the slab through every river on the board.
  const boardFloor = Math.min(...cells.flat().map((cell) => terrainModels.bottomOf(cell.ground)));
  const boardBase = createBoardBase(scene, boardFloor, gridWidth, gridHeight);

  /**
   * The eight corners of the board as an object, measured off the slab.
   *
   * ⚠️ The slab is in here rather than just the playing surface: it hangs below
   * the board and is part of the silhouette, so a fit that ignored it would clip
   * it at shallow angles -- which is exactly where it is most of what you see.
   */
  boardBase.computeWorldMatrix(true);
  const box = boardBase.getBoundingInfo().boundingBox;
  const boardCorners = [box.minimumWorld.x, box.maximumWorld.x].flatMap((x) =>
    [box.minimumWorld.z, box.maximumWorld.z].flatMap((z) =>
      [box.minimumWorld.y, groundLevel].map((y) => new Vector3(x, y, z)),
    ),
  );

  /**
   * How much room the board needs, worked out **once** and never again.
   *
   * ⚠️ **Nothing here may read the camera.** A fit that consults the current
   * angle rescales the board as the camera moves, which is the camera
   * breathing, and it is wrong at both ends: a square board is `half-width`
   * across down an axis and `half-diagonal` across at 45°, and its depth
   * projects by `cos β`, which changes as you tilt. A mouse drag moves *both*,
   * so consulting either is enough to make a still board change size while you
   * look at it.
   *
   * So both numbers are the worst case over everywhere the camera may go:
   * `reachX` is the ground-plane half-diagonal, which no `alpha` exceeds, and
   * `reachY` is measured at `CAMERA_BETA_TOPDOWN`, the most overhead tilt
   * allowed and so the one that needs the most vertical room.
   *
   * ⚠️ The price is dead space at every angle that is not the worst one -- on a
   * 12×12 the board sits in about three quarters of the height it could fill
   * looking down an axis. That is what a still image costs, and it is a better
   * trade than a board that resizes itself whenever the camera turns.
   */
  const boardRadius = Math.max(...boardCorners.map((corner) => Math.hypot(corner.x, corner.z)));
  const boardRise = Math.max(...boardCorners.map((corner) => Math.abs(corner.y)));
  const reachX = boardRadius;
  const reachY =
    boardRadius * Math.cos(CAMERA_BETA_TOPDOWN) + boardRise * Math.sin(CAMERA_BETA_TOPDOWN);

  /**
   * Sizes the frustum, then keeps the board under it.
   *
   * Run every frame rather than on a change, because everything it depends on
   * -- the orbit, the tilt, the zoom, the window -- moves independently, and
   * sixteen dot products is not worth the bookkeeping of tracking which.
   */
  const holdTheBoard = (): void => {
    const aspect = canvas.clientWidth / canvas.clientHeight;

    // ⚠️ Only the **window** and the **wheel** get a say. `reachX` and `reachY`
    // were settled at build time and no camera angle is read here, which is the
    // whole point: turn the board and it turns, nothing else.
    const extent = (Math.max(reachY, reachX / aspect) * FIT_MARGIN) / zoom;
    camera.orthoLeft = -extent * aspect;
    camera.orthoRight = extent * aspect;
    camera.orthoTop = extent;
    camera.orthoBottom = -extent;

    // ⚠️ **Panning is clamped to the board, and centring falls out of it.** Per
    // axis the target may stray by however much board the viewport does not
    // already cover -- and at full zoom-out it covers all of it, the expression
    // goes to zero, and the board is centred with nowhere to pan. Centring is
    // not a rule of its own; it is this clamp at its limit.
    const right = camera.getDirection(Vector3.Right());
    const up = camera.getDirection(Vector3.Up());
    // ⚠️ Built from the same fixed reach, so the pan limits do not move either.
    // A limit that shrank as the camera turned would snap a panned camera back,
    // which is the same fidget somewhere else.
    const slackX = Math.max(0, reachX - extent * aspect);
    const slackY = Math.max(0, reachY - extent);

    // The board is centred on the origin, so the target *is* its own offset.
    const alongX = Vector3.Dot(camera.target, right);
    const alongY = Vector3.Dot(camera.target, up);
    const heldX = Math.min(slackX, Math.max(-slackX, alongX));
    const heldY = Math.min(slackY, Math.max(-slackY, alongY));
    if (heldX !== alongX || heldY !== alongY) {
      camera.target.copyFrom(right.scale(heldX).add(up.scale(heldY)));
    }
  };
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
    surfaceAt,
    gridWidth,
    gridHeight,
  });
  const routeArrow = createRouteArrow(scene, {
    name: 'movement-route',
    color: ROUTE_COLOR,
    alpha: ROUTE_ALPHA,
    height: ROUTE_HEIGHT,
    surfaceAt,
    gridWidth,
    gridHeight,
  });
  const attackOverlay = createTileOverlay(scene, {
    name: 'attack-range',
    color: ATTACK_COLOR,
    alpha: ATTACK_ALPHA,
    height: ATTACK_HEIGHT,
    surfaceAt,
    gridWidth,
    gridHeight,
  });
  const chargeOverlay = createTileOverlay(scene, {
    name: 'charge-targets',
    color: CHARGE_COLOR,
    alpha: CHARGE_ALPHA,
    height: CHARGE_HEIGHT,
    surfaceAt,
    gridWidth,
    gridHeight,
  });

  const facingOverlay = createTileOverlay(scene, {
    name: 'facing-choices',
    color: FACING_COLOR,
    alpha: FACING_ALPHA,
    height: FACING_HEIGHT,
    surfaceAt,
    gridWidth,
    gridHeight,
  });

  // Awaited before any unit exists: a renderer whose units are still loading
  // would give syncUnits and playEvents a window in which a unit has no mesh.
  const models = await loadUnitModels(scene);

  // ⚠️ Seeded with the board's own starting state, so there is never a moment
  // when nothing has been drawn. Advanced only by `syncUnits`.
  let drawn: GameState = initialState;

  const unitMeshes = new Map<string, TransformNode>();
  // Parallel to `unitMeshes` and disposed with it: a ring is a *child* of its
  // unit's node, so `mesh.dispose` takes it, and only this map needs clearing.
  const healthRings = new Map<string, HealthRing>();
  for (const unit of initialState.units) {
    const owner = initialState.players.find((player) => player.id === unit.owner);
    if (!owner) throw new Error(`unit ${unit.id} has unknown owner ${unit.owner}`);
    const node = createUnitMesh(scene, models, unit, owner.color, surfaceAt, gridWidth, gridHeight);
    unitMeshes.set(unit.id, node);
    const ring = createHealthRing(scene, node);
    ring.setHealth(unit.health);
    healthRings.set(unit.id, ring);
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
    screenToTile(
      scene,
      camera,
      scene.pointerX,
      scene.pointerY,
      gridWidth,
      gridHeight,
      surfaceAt,
      levels,
    );

  // Where a DOM overlay is pinned, and what it is pinned to. Both null unless
  // something is anchored, which is the common case.
  let anchorElement: HTMLElement | null = null;
  let anchorTile: Coordinate | null = null;

  const placeAnchor = (): void => {
    if (!anchorElement || !anchorTile) return;
    const { x, z } = tileToWorld(anchorTile, gridWidth, gridHeight);
    const screen = Vector3.Project(
      new Vector3(x, surfaceAt(anchorTile), z),
      Matrix.Identity(),
      scene.getTransformMatrix(),
      camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
    );
    // ⚠️ Projection lands in render-buffer pixels and CSS wants CSS pixels.
    // They are equal today (`adaptToDeviceRatio` is off, so the scaling level
    // is 1) and would silently diverge on a retina display the day it is not.
    const scale = engine.getHardwareScalingLevel();
    // Centred above the tile: the element's own size is its business, so this
    // shifts by its own extent rather than measuring anything.
    anchorElement.style.transform = `translate(${screen.x * scale}px, ${screen.y * scale}px) translate(-50%, -100%)`;
  };

  const cutaway = createCutaway(scene, models, terrainModels, camera);
  let cutawayHandler: ((scene: CutawayScene | null) => void) | null = null;
  let battleCount = 0;

  /**
   * Play one battle: raise the views, hold, drop them.
   *
   * ⚠️ **Its own branch, never part of the `unitMoved` one.** That branch skips a
   * move whose mesh already stands at its destination -- true of an approach the
   * player previewed -- and a charge's cutaway would be skipped along with it.
   */
  const playBattle = async (event: BattleResolvedEvent): Promise<void> => {
    const before = drawn;
    const side = (id: string, after: number): CutawaySide | null => {
      const unit = before.units.find((u) => u.id === id);
      const owner = before.players.find((p) => p.id === unit?.owner);
      if (!unit || !owner) return null;
      return {
        unitTypeId: unit.unitTypeId,
        color: owner.color,
        before: unit.health,
        after,
        defense: getTerrain(before.grid[unit.position.row][unit.position.col]).defense,
      };
    };

    const attacker = side(event.attacker.unitId, event.attacker.health);
    const defender = side(event.defender.unitId, event.defender.health);
    // A participant the last-drawn state does not know is a desync, not a
    // drawable battle. Skipping beats staging a blank.
    if (!attacker || !defender) return;

    const attackerUnit = before.units.find((u) => u.id === event.attacker.unitId)!;
    const defenderUnit = before.units.find((u) => u.id === event.defender.unitId)!;
    cutaway.show(
      {
        unitTypeId: attacker.unitTypeId,
        color: attacker.color,
        facing: attackerUnit.facing,
        cell: cells[attackerUnit.position.row][attackerUnit.position.col],
      },
      {
        unitTypeId: defender.unitTypeId,
        color: defender.color,
        facing: defenderUnit.facing,
        cell: cells[defenderUnit.position.row][defenderUnit.position.col],
      },
    );
    cutawayHandler?.({ id: (battleCount += 1), kind: event.kind, attacker, defender });

    await new Promise((resolve) => setTimeout(resolve, CUTAWAY_MS));

    cutaway.hide();
    cutawayHandler?.(null);
  };

  let clickHandler: ((coordinate: Coordinate) => void) | null = null;
  scene.onPointerObservable.add((pointerInfo) => {
    if (pointerInfo.type === PointerEventTypes.POINTERMOVE) {
      const coordinate = hoveredCoordinate();
      setHighlightTile(hoverHighlight, coordinate, HOVER_HEIGHT, surfaceAt, gridWidth, gridHeight);
      return;
    }

    // ⚠️ **`POINTERTAP`, not `POINTERPICK`, and the difference is a bug that
    // shipped.** Babylon only emits `POINTERPICK` when its ray actually hits a
    // *pickable mesh* -- and the terrain sets `isPickable = false`, precisely
    // because picking here is plane arithmetic and wants no ray at a mesh. So
    // clicks only ever arrived where some other pickable mesh happened to be:
    // a unit, a tree, or a lit overlay quad. Bare ground swallowed them.
    //
    // That was survivable while every meaningful click was on a unit or a lit
    // tile, which is why it went unnoticed; it is not survivable now that "a
    // click on the dark backs out" is a rule. `POINTERTAP` fires for any tap
    // that is not a drag, which is what the plane arithmetic always assumed.
    if (pointerInfo.type === PointerEventTypes.POINTERTAP && clickHandler) {
      const coordinate = hoveredCoordinate();
      if (coordinate) clickHandler(coordinate);
    }
  });

  engine.runRenderLoop(() => {
    holdTheBoard();
    scene.render();
    placeAnchor();
  });

  const handleResize = (): void => {
    engine.resize();
  };
  window.addEventListener('resize', handleResize);

  return {
    onTileClick(handler) {
      clickHandler = handler;
    },
    setSelectedTile(coordinate) {
      setHighlightTile(
        selectedHighlight,
        coordinate,
        SELECTED_HEIGHT,
        surfaceAt,
        gridWidth,
        gridHeight,
      );
    },
    setFacingChoices(tiles) {
      facingOverlay.setTiles(tiles);
    },
    setRange(tiles) {
      rangeOverlay.setTiles(tiles);
    },
    setRoute(path) {
      routeArrow.setPath(path);
    },
    setAttackRange(tiles) {
      attackOverlay.setTiles(tiles);
    },
    setChargeTargets(tiles) {
      chargeOverlay.setTiles(tiles);
    },
    anchorTo(element, coordinate) {
      anchorElement = element;
      anchorTile = coordinate;
      // Placed now rather than next frame: an overlay that appears at its
      // previous position and corrects a frame later reads as a jump.
      placeAnchor();
    },
    onCutaway(handler) {
      cutawayHandler = handler;
    },
    async playEvents(events) {
      for (const event of events) {
        if (event.type === 'battleResolved') {
          await playBattle(event);
          continue;
        }
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

        await animateUnitAlongPath(mesh, event.path, surfaceAt, gridWidth, gridHeight, scene);
      }
    },
    previewMove(unitId, path) {
      endPreview();
      const mesh = unitMeshes.get(unitId);
      if (!mesh) return Promise.resolve();

      let settle!: () => void;
      const settled = new Promise<void>((resolve) => (settle = resolve));
      preview = { unitId, origin: path[0], facing: getUnitFacing(mesh), settle };

      void animateUnitAlongPath(mesh, path, surfaceAt, gridWidth, gridHeight, scene).then(() => {
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
        mesh.position.set(home.x, surfaceAt(previewed.origin), home.z);
        setUnitFacing(mesh, previewed.facing);
      }
      endPreview();
    },
    lastDrawn() {
      return drawn;
    },
    syncUnits(state) {
      // Recorded before the work, not after: everything below reads `state`
      // anyway, and a mid-function throw would otherwise leave this behind by
      // one commit -- a silent, permanent one-turn lag in any damage animation.
      drawn = state;
      // Authority overwrites every position, the previewed one included, so
      // this *is* the preview ending -- there is no separate commit.
      //
      // ⚠️ Before the removal pass, not after. A live preview holds a unit by
      // id and animates its mesh; disposing that node first would leave a tween
      // writing into a destroyed object.
      endPreview();

      // Whatever the authority no longer lists is dead, and a mesh nobody
      // removes stands on the board for the rest of the match -- unselectable,
      // unkillable, and in the way.
      const alive = new Set(state.units.map((unit) => unit.id));
      for (const [id, mesh] of unitMeshes) {
        if (alive.has(id)) continue;
        // Stop first: a tween outliving its target writes into a dead node.
        scene.stopAnimation(mesh);
        // ⚠️ The second argument is the one that matters, and it is why this is
        // not a bare `dispose()`. Every unit of a colour **shares one
        // material**, cached on the scene by name -- disposing it with the
        // first casualty would leave the rest of that army untextured, several
        // turns later and looking unrelated. The first argument stays false so
        // the model's child meshes go with it.
        mesh.dispose(false, false);
        unitMeshes.delete(id);
        // The ring was a child and went with the node; only the entry is left.
        healthRings.delete(id);
      }

      for (const unit of state.units) {
        const mesh = unitMeshes.get(unit.id);
        if (!mesh) continue;
        // Stop first: a snap must win over any tween still writing positions.
        scene.stopAnimation(mesh);
        const target = tileToWorld(unit.position, gridWidth, gridHeight);
        mesh.position.set(target.x, surfaceAt(unit.position), target.z);
        setUnitFacing(mesh, unit.facing);
        // ⚠️ Snapped, like the position beside it. Once damage animates, the
        // tween belongs in `playEvents` and this stays the corrector -- and it
        // will need stopping the ring's own animation, which
        // `scene.stopAnimation(mesh)` above does *not* reach.
        healthRings.get(unit.id)?.setHealth(unit.health);
      }
    },
    toggleInspector() {
      void toggleInspector(scene);
    },
    dispose() {
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('wheel', handleWheel);
      engine.dispose();
    },
  };
}
