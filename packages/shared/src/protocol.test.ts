import { describe, expect, it } from 'bun:test';
import { parseCommand } from './protocol';

// parseCommand is the only thing standing between an attacker-controlled POST
// body and the authority. TypeScript is erased, so every guarantee here is a
// runtime one.
describe('parseCommand', () => {
  const path = [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
  ];

  describe('accepts', () => {
    it('a move command', () => {
      expect(parseCommand({ type: 'move', unitId: 'u1', path })).toEqual({
        type: 'move',
        unitId: 'u1',
        path,
      });
    });

    it('an endTurn command', () => {
      expect(parseCommand({ type: 'endTurn' })).toEqual({ type: 'endTurn' });
    });

    it('a single-element path -- legal, and means "act without moving"', () => {
      const single = [{ col: 3, row: 4 }];
      expect(parseCommand({ type: 'move', unitId: 'u1', path: single })).toEqual({
        type: 'move',
        unitId: 'u1',
        path: single,
      });
    });
  });

  describe('rejects', () => {
    const rejected: [string, unknown][] = [
      ['null', null],
      ['a string', 'move'],
      ['an array', [{ type: 'endTurn' }]],
      ['an unknown type', { type: 'selfDestruct' }],
      ['a missing type', { unitId: 'u1', path }],
      ['a non-string unitId', { type: 'move', unitId: 7, path }],
      ['a missing path', { type: 'move', unitId: 'u1' }],
      ['a non-array path', { type: 'move', unitId: 'u1', path: 'north' }],
      ['an empty path', { type: 'move', unitId: 'u1', path: [] }],
      ['a path holding a non-coordinate', { type: 'move', unitId: 'u1', path: [{ col: 0 }] }],
      [
        'a path with non-integer coordinates',
        { type: 'move', unitId: 'u1', path: [{ col: 0.5, row: 1 }] },
      ],
    ];

    for (const [name, input] of rejected) {
      it(name, () => expect(parseCommand(input)).toBeNull());
    }

    // A defensive allocation bound, not a game rule -- validatePath owns the
    // real limit. This stops a body that fits under maxRequestBodySize from
    // still materialising thousands of coordinates.
    it('a path longer than MAX_PATH_STEPS', () => {
      const long = Array.from({ length: 257 }, (_, i) => ({ col: i, row: 0 }));
      expect(parseCommand({ type: 'move', unitId: 'u1', path: long })).toBeNull();
      expect(parseCommand({ type: 'move', unitId: 'u1', path: long.slice(0, 256) })).not.toBeNull();
    });
  });

  // The security property: parseCommand *constructs* the result rather than
  // passing the input through, so a client cannot smuggle fields into the
  // authority -- `actor` above all, which is what keeps Command and Action
  // distinct at runtime rather than only in the type system.
  describe('drops everything it was not asked for', () => {
    it('strips a smuggled actor from a move', () => {
      const parsed = parseCommand({ type: 'move', unitId: 'u1', path, actor: 'red' });
      expect(parsed).not.toBeNull();
      expect(parsed).not.toHaveProperty('actor');
    });

    it('strips a smuggled actor from an endTurn', () => {
      const parsed = parseCommand({ type: 'endTurn', actor: 'red' });
      expect(parsed).toEqual({ type: 'endTurn' });
    });

    it('strips arbitrary extra properties', () => {
      const parsed = parseCommand({ type: 'move', unitId: 'u1', path, rolls: [6, 6] });
      expect(Object.keys(parsed ?? {}).sort()).toEqual(['path', 'type', 'unitId']);
    });

    it('strips extra properties from inside a coordinate', () => {
      const parsed = parseCommand({
        type: 'move',
        unitId: 'u1',
        path: [{ col: 0, row: 0, elevation: 9 }],
      });
      expect(parsed).toEqual({ type: 'move', unitId: 'u1', path: [{ col: 0, row: 0 }] });
    });
  });
});
