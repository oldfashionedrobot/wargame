/**
 * What the charge tables actually mean, printed as odds and what failing costs.
 *
 *     bun packages/shared/scripts/charges.ts
 *
 * ⚠️ **The companion to `matchups.ts`, and it prints a different artefact
 * because charge is a different question.** Damage is tuned against
 * hits-to-kill; a charge is tuned against *the health a target has to be at
 * before the gamble is worth taking*, which is the odds column read against the
 * repel band beside it.
 *
 * ⚠️ **Printed on every distinct depth of cover, because cover is half the
 * mechanic.** Terrain does not shift a charge's odds by a point or two any
 * more; it sets a *ceiling* on them, so a road-only table would show the curve
 * and hide the cap. One block per star count rather than per terrain -- road,
 * bridge, plains and river are all 0 now and would print four identical
 * tables.
 *
 * ⚠️ **All three approaches, because head-on alone cannot be trusted.** A base
 * value that reads reasonable front-on can saturate at the flank and leave the
 * rear distinction doing nothing -- the multiplied threshold passes 100 and every
 * health becomes automatic. That is the mechanic's signature moment where it is
 * intended and a dead dial where it is not, and the two look identical in a
 * head-on column.
 */
import { chargeChance, chargeThreshold, repelDamage } from '../src/combat';
import { TERRAIN } from '../src/data/terrain';
import { makeState } from '../src/testing';
import type { UnitTypeId } from '../src/data/unitTypes';
import type { Unit } from '../src/types';

const CHARGERS: UnitTypeId[] = ['cavalry', 'infantry'];
const TARGETS: UnitTypeId[] = ['infantry', 'cavalry', 'artillery'];
const HEALTHS = [100, 85, 70, 55, 40, 25];

/**
 * ⚠️ The **defender's** facing decides the side, so the approach is set by
 * turning the target rather than by moving the attacker: `south` looks straight
 * at a charger coming from the south, `north` looks away, `east` takes it on
 * the flank.
 */
const FACING = { 'head-on': 'south', flank: 'east', rear: 'north' } as const;

const board = (
  attacker: UnitTypeId,
  defender: UnitTypeId,
  health: number,
  facing: (typeof FACING)[keyof typeof FACING],
  ground: string,
) =>
  makeState(
    ['...', '.-.', `.${ground}.`],
    [
      { id: 'b1', col: 1, row: 1, unitTypeId: attacker },
      { id: 'r1', col: 1, row: 2, owner: 'red', unitTypeId: defender, health, facing },
    ],
  );

/**
 * One representative tile per distinct star count, named by everything that
 * shares it.
 *
 * ⚠️ **Grouped rather than listed, so the print-out cannot go stale.** Terrains
 * that share a `defense` are indistinguishable to a charge, and printing each
 * of them separately would be four identical tables today and a silently
 * missing one the day a terrain is added.
 */
const COVER = [...new Set(Object.values(TERRAIN).map((g) => g.defense))]
  .sort((a, b) => a - b)
  .map((stars) => {
    const sharing = Object.entries(TERRAIN).filter(([, g]) => g.defense === stars);
    return { stars, char: sharing[0][1].char, names: sharing.map(([name]) => name).join(', ') };
  });

// What failing costs in each cell: the base at a near miss, up to the worst
// failing roll. It depends on the odds, which set how far a roll can miss, and
// on the defender's health, which sets what each point of miss is worth.
const failureBand = (defender: Unit, chance: number) =>
  chance >= 100
    ? '—'
    : `${repelDamage(defender, chance, chance)}–${repelDamage(defender, chance, 99)}`;

const CELL = 12;
console.log('odds to break, then what failing costs\n');

for (const { stars, char, names } of COVER) {
  console.log(`\n${stars} ${stars === 1 ? 'star' : 'stars'} — ${names}`);
  for (const [approach, facing] of Object.entries(FACING)) {
    console.log(`  ${approach}`);
    console.log(`${''.padEnd(24)}${HEALTHS.map((h) => `${h}hp`.padStart(CELL)).join('')}`);
    for (const attacker of CHARGERS) {
      for (const defender of TARGETS) {
        if (chargeThreshold(attacker, defender) === null) continue;
        const cells = HEALTHS.map((health) => {
          const state = board(attacker, defender, health, facing, char);
          const chance = chargeChance(state, state.units[0], state.units[1])!;
          return `${chance}% ${failureBand(state.units[1], chance)}`.padStart(CELL);
        });
        console.log(`${`${attacker} → ${defender}`.padEnd(24)}${cells.join('')}`);
      }
    }
  }
}
