/**
 * What a charge finishes, beside what an attack would.
 *
 *     bun packages/shared/scripts/charges.ts
 *
 * ⚠️ **The companion to `matchups.ts`, printed as kill lines rather than hits.**
 * A charge is offered only where it kills, so the question is *how worn down a
 * target has to be*: the most health a charge finishes, head-on, from the flank
 * and from the rear, next to the most an attack is sure to kill at its worst
 * roll and might kill at its best. A charge is an attack's worst roll times the
 * side, so the head-on column equals the first of those, and the other two are
 * what getting round a unit buys.
 *
 * ⚠️ **Per ground and per charger health**, because both move the lines: cover
 * and the attacker's band work as they do in an attack.
 */
import { chargeDamage, computeDamage } from '../src/combat';
import { LUCK_MAX } from '../src/data/combat';
import { getUnitType } from '../src/data/unitTypes';
import type { UnitTypeId } from '../src/data/unitTypes';
import { makeState } from '../src/testing';
import type { Facing } from '../src/types';

const TYPES: UnitTypeId[] = ['infantry', 'cavalry', 'artillery'];
const CHARGERS = [100, 70, 40];
const GROUNDS = [
  ['open', '.'],
  ['wood', 'f'],
  ['peak', '^'],
] as const;

/**
 * ⚠️ The **defender's** facing decides the side, so the approach is set by
 * turning the target rather than by moving the attacker: `south` looks straight
 * at a charger coming from the south, `east` takes it on the flank, `north`
 * looks away.
 */
const SIDES: Facing[] = ['south', 'east', 'north'];

const board = (
  attacker: UnitTypeId,
  charger: number,
  defender: UnitTypeId,
  health: number,
  facing: Facing,
  ground: string,
) =>
  makeState(
    ['...', '.-.', `.${ground}.`],
    [
      { id: 'b1', col: 1, row: 1, unitTypeId: attacker, health: charger },
      { id: 'r1', col: 1, row: 2, owner: 'red', unitTypeId: defender, health, facing },
    ],
  );

/** The most health a target can have and still die to `damage`, read at every health. */
const killLine = (damage: (health: number) => number) => {
  let line = 0;
  for (let health = 1; health <= 100; health++) if (damage(health) >= health) line = health;
  return line;
};

console.log(
  'the most health each finishes: attack at worst–best roll | charge head-on / flank / rear',
);

for (const attacker of TYPES.filter((type) => getUnitType(type).charges)) {
  for (const defender of TYPES) {
    console.log(`\n${attacker} → ${defender}`);
    for (const charger of CHARGERS) {
      for (const [name, char] of GROUNDS) {
        const attack = (roll: number) =>
          killLine((health) => {
            const state = board(attacker, charger, defender, health, 'south', char);
            return computeDamage(state, state.units[0], state.units[1], roll);
          });
        const charge = SIDES.map((facing) =>
          killLine((health) => {
            const state = board(attacker, charger, defender, health, facing, char);
            return chargeDamage(state, state.units[0], state.units[1]);
          }),
        );
        console.log(
          `  ${`${charger}hp`.padEnd(7)}${name.padEnd(6)}${`${attack(0)}–${attack(LUCK_MAX)}`.padEnd(9)}| ${charge.join(' / ')}`,
        );
      }
    }
  }
}
