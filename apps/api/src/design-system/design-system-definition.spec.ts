import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import {
  type DesignSystemDefinition,
  parseDesignSystemDefinition,
} from './design-system-definition';
import {
  DEFINITION_FILE,
  DESIGN_SYSTEM_SEED_DIR,
} from './design-system.constants';

type Raw = DesignSystemDefinition;

const marginYaml = readFileSync(
  join(DESIGN_SYSTEM_SEED_DIR, 'margin', DEFINITION_FILE),
  'utf8',
);

/** A valid definition, as a plain object a test can break one way. */
const validRaw = (): Raw => parse(marginYaml) as Raw;

const errorsFor = (mutate: (raw: Raw) => void): string[] => {
  const raw = validRaw();
  mutate(raw);
  const result = parseDesignSystemDefinition(stringify(raw));
  if (result.success) throw new Error('expected the definition to fail');
  return result.errors;
};

describe('parseDesignSystemDefinition', () => {
  it('should parse a definition when every cross-reference resolves', () => {
    const result = parseDesignSystemDefinition(marginYaml);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.definition.id).toBe('margin');
      expect(result.definition.composition.pageRoles[1].position).toBe('any');
    }
  });

  it('should parse every launch definition when read from the seed directory', () => {
    const ids = readdirSync(DESIGN_SYSTEM_SEED_DIR, {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(ids).toHaveLength(6);
    for (const id of ids) {
      const result = parseDesignSystemDefinition(
        readFileSync(join(DESIGN_SYSTEM_SEED_DIR, id, DEFINITION_FILE), 'utf8'),
      );
      expect(result).toMatchObject({ success: true });
    }
  });

  it('should report a yaml error when the text is not valid yaml', () => {
    const result = parseDesignSystemDefinition('id: [unclosed');

    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors[0]).toMatch(/^yaml: /);
  });

  it('should reject the definition when its contract is not the supported one', () => {
    expect(errorsFor((raw) => Object.assign(raw, { contract: 2 }))).toEqual([
      expect.stringMatching(/^contract: /),
    ]);
  });

  it('should reject the definition when it has an unknown top-level key', () => {
    expect(errorsFor((raw) => Object.assign(raw, { theme: 'bold' }))).toEqual([
      expect.stringContaining('theme'),
    ]);
  });

  it('should report every error at once when there are several', () => {
    const errors = errorsFor((raw) => {
      raw.page.background = 'nope';
      raw.icons.colors = ['neon'];
    });

    expect(errors).toHaveLength(2);
  });

  describe('cross-reference errors', () => {
    const cases: [string, (raw: Raw) => void, string][] = [
      [
        'a palette token name is duplicated',
        (raw) => raw.palette.tokens.push({ ...raw.palette.tokens[0] }),
        'palette.tokens.4.name: duplicate name "white"',
      ],
      [
        'pages.max is below pages.min',
        (raw) => (raw.page.pages = { min: 5, max: 2 }),
        'page.pages.max: pages.max must be >= pages.min',
      ],
      [
        'page.background is an unknown token',
        (raw) => (raw.page.background = 'paper'),
        'page.background: unknown colour token "paper"',
      ],
      [
        'a pairing text is an unknown token',
        (raw) => (raw.palette.pairings[0].text = 'ghost'),
        'palette.pairings.0.text: unknown colour token "ghost"',
      ],
      [
        'a pairing ground is an unknown token',
        (raw) => (raw.palette.pairings[0].on = 'ghost'),
        'palette.pairings.0.on: unknown colour token "ghost"',
      ],
      [
        'a scale step names an unknown font',
        (raw) => (raw.typography.scale[0].font = 'display'),
        'typography.scale.0.font: unknown font token "display"',
      ],
      [
        'a scale step uses a weight its font does not ship',
        (raw) => (raw.typography.scale[0].weight = 700),
        'typography.scale.0.weight: font "sans" does not ship weight 700',
      ],
      [
        'a scale step is below the floor',
        (raw) => (raw.typography.scale[3].px = 16),
        'typography.scale.3.px: 16px is below typography.rules.minPx (24)',
      ],
      [
        'an icon colour is an unknown token',
        (raw) => (raw.icons.colors = ['neon']),
        'icons.colors.0: unknown colour token "neon"',
      ],
      [
        'a spacing step is not a multiple of the base',
        (raw) => raw.spacing.scale.push(20),
        'spacing.scale.9: 20 is not a multiple of spacing.base (8)',
      ],
      [
        'the safe area is not a spacing step',
        (raw) => (raw.page.safeArea.top = 96),
        'page.safeArea.top: 96 is not a step in the spacing scale',
      ],
      [
        'two page roles are pinned first',
        (raw) => (raw.composition.pageRoles[1].position = 'first'),
        'composition.pageRoles: more than one page role is pinned to position "first"',
      ],
      [
        'two page roles are pinned last',
        (raw) => (raw.composition.pageRoles[1].position = 'last'),
        'composition.pageRoles: more than one page role is pinned to position "last"',
      ],
    ];

    it('should cover thirteen distinct errors when every case is listed', () => {
      expect(new Set(cases.map(([, , error]) => error)).size).toBe(13);
    });

    it.each(cases)(
      'should reject the definition when %s',
      (_condition, mutate, error) => {
        expect(errorsFor(mutate)).toEqual([error]);
      },
    );
  });
});
