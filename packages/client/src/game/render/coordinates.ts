import { Vector3 } from '@babylonjs/core';
import type { Coordinate } from '@aw/shared';

export const TILE_SIZE = 1;

export function tileToWorld(
  coordinate: Coordinate,
  gridWidth: number,
  gridHeight: number,
): Vector3 {
  const offsetX = ((gridWidth - 1) * TILE_SIZE) / 2;
  const offsetZ = ((gridHeight - 1) * TILE_SIZE) / 2;
  return new Vector3(coordinate.col * TILE_SIZE - offsetX, 0, coordinate.row * TILE_SIZE - offsetZ);
}

export function worldToTile(
  x: number,
  z: number,
  gridWidth: number,
  gridHeight: number,
): Coordinate {
  const offsetX = ((gridWidth - 1) * TILE_SIZE) / 2;
  const offsetZ = ((gridHeight - 1) * TILE_SIZE) / 2;
  return {
    col: Math.round((x + offsetX) / TILE_SIZE),
    row: Math.round((z + offsetZ) / TILE_SIZE),
  };
}

export interface GridBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function gridBounds(gridWidth: number, gridHeight: number): GridBounds {
  const offsetX = ((gridWidth - 1) * TILE_SIZE) / 2;
  const offsetZ = ((gridHeight - 1) * TILE_SIZE) / 2;
  const half = TILE_SIZE / 2;
  return {
    minX: -offsetX - half,
    maxX: offsetX + half,
    minZ: -offsetZ - half,
    maxZ: offsetZ + half,
  };
}
