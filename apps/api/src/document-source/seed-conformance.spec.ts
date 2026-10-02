import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readSeedFiles } from '../design-system/design-system-seed';
import { DESIGN_SYSTEM_SEED_DIR } from '../design-system/design-system.constants';
import { assemble } from './assemble';
import { check } from './candidate-check';

/**
 * Test layer 2 (§11.2): every seed's `sample.html` is a conforming Candidate
 * Source for its own definition, and assembles into a Document Source.
 */
const seeds = readSeedFiles(DESIGN_SYSTEM_SEED_DIR).map((seed) => ({
  id: seed.definition.id,
  definition: seed.definition,
  sample: readFileSync(join(dirname(seed.path), 'sample.html'), 'utf8'),
}));

describe('seed conformance', () => {
  it('should cover all six launch systems', () => {
    expect(seeds.map((seed) => seed.id).sort()).toEqual([
      'afterglow',
      'broadside',
      'colophon',
      'margin',
      'overprint',
      'schematic',
    ]);
  });

  describe.each(seeds)('$id', ({ definition, sample }) => {
    it('should check with zero violations', () => {
      expect(check(definition, sample)).toEqual([]);
    });

    it('should assemble', () => {
      expect(() => assemble(definition, sample)).not.toThrow();
    });
  });
});
