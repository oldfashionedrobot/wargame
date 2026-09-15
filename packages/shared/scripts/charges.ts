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
 * ⚠️ **Printed on road**, where terrain adds nothing. Every other tile makes a
 * charge harder, and plains -- which is where units mostly stand -- costs the
 * attacker a point or two that this table deliberately does not show.
 *
 * ⚠️ **All three approaches, because head-on alone cannot be trusted.** A base
 * value that reads reasonable front-on can saturate at the flank and leave the
 * rear distinction doing nothing -- the multiplied threshold passes 100 and every
 * health becomes automatic. That is the mechanic's signature moment where it is
 * intended and a dead dial where it is not, and the two look identical in a
 * head-on column.
 */
import { chargeChance, chargeThreshold } from '../src/combat';
import { CHARGE_REPEL, REPEL_DIVISOR } from '../src/data/combat';
import { makeState } from '../src/testing';
import type { UnitTypeId } from '../src/data/unitTypes';

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
) =>
  makeState(
    ['...', '.-.', '.-.'],
    [
      { id: 'b1', col: 1, row: 1, unitTypeId: attacker },
      { id: 'r1', col: 1, row: 2, owner: 'red', unitTypeId: defender, health, facing },
    ],
  );

console.log(`odds to break, on road.  repel is flat + overshoot/${REPEL_DIVISOR}\n`);

for (const [approach, facing] of Object.entries(FACING)) {
  console.log(`  ${approach}`);
  console.log(
    `${''.padEnd(24)}${HEALTHS.map((h) => `${h}hp`.padStart(7)).join('')}   failing costs`,
  );
  for (const attacker of CHARGERS) {
    for (const defender of TARGETS) {
      if (chargeThreshold(attacker, defender) === null) continue;
      const odds = HEALTHS.map((health) => {
        const state = board(attacker, defender, health, facing);
        return `${chargeChance(state, state.units[0], state.units[1])!}%`.padStart(7);
      });
      const repel = CHARGE_REPEL[defender];
      console.log(
        `${`${attacker} → ${defender}`.padEnd(24)}${odds.join('')}   ${repel}–${repel + 9}`,
      );
    }
  }
  console.log();
}
