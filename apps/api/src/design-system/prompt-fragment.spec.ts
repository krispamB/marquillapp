import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type DesignSystemDefinition,
  parseDesignSystemDefinition,
} from './design-system-definition';
import {
  DEFINITION_FILE,
  DESIGN_SYSTEM_SEED_DIR,
} from './design-system.constants';
import { renderPromptFragment } from './prompt-fragment';

const load = (id: string): DesignSystemDefinition => {
  const result = parseDesignSystemDefinition(
    readFileSync(join(DESIGN_SYSTEM_SEED_DIR, id, DEFINITION_FILE), 'utf8'),
  );
  if (!result.success) throw new Error(result.errors.join('\n'));
  return result.definition;
};

describe('renderPromptFragment', () => {
  it('should state every enforced list when given a definition', () => {
    const ds = load('margin');

    const fragment = renderPromptFragment(ds);

    expect(fragment).toContain('DESIGN SYSTEM: Margin (margin v1)');
    expect(fragment).toContain('- ink #0a0a0a (text) -> var(--ds-ink)');
    expect(fragment).toContain('- ink on white');
    expect(fragment).toContain('8, 16, 24, 32, 48, 64, 112, 160, 224');
    expect(fragment).toContain('Available: arrow-right.');
    expect(fragment).toContain('- title (first page, required):');
  });

  it('should state the usable box inside the safe area when given a definition', () => {
    const ds = load('margin');

    const fragment = renderPromptFragment(ds);

    // margin: 1080x1350 with a 112px safe area all round.
    expect(fragment).toContain('Every page is exactly 1080x1350px');
    expect(fragment).toContain('already pads every page by the safe area');
    expect(fragment).toContain('usable box is 856x1126px');
  });

  it('should derive the usable box when each side of the safe area differs', () => {
    const ds = load('margin');

    const fragment = renderPromptFragment({
      ...ds,
      version: 98,
      page: {
        ...ds.page,
        safeArea: { top: 10, right: 20, bottom: 30, left: 40 },
      },
    });

    expect(fragment).toContain('10px top, 20px right, 30px bottom, 40px left');
    expect(fragment).toContain('usable box is 1020x1310px');
  });

  // usable height / (body px × line-height), floored; then 80% of that, floored.
  it.each([
    ['afterglow', '28px/1.5', 27, 21],
    ['broadside', '30px/1.4', 28, 22],
    ['colophon', '28px/1.5', 27, 21],
    ['margin', '30px/1.45', 25, 20],
    ['overprint', '28px/1.45', 29, 23],
    ['schematic', '26px/1.5', 30, 24],
  ])(
    'should state the line budget for %s when given its seed',
    (id, body, lines, fill) => {
      const fragment = renderPromptFragment(load(id));

      expect(fragment).toContain(
        `At ${body} body text the usable box holds about ${lines} lines, headings and gaps included. Fill at most 80% of that (about ${fill} lines); cut words rather than shrink type.`,
      );
    },
  );

  it('should omit the line budget when the scale has no body step', () => {
    const ds = load('margin');

    const fragment = renderPromptFragment({
      ...ds,
      version: 97,
      typography: {
        ...ds.typography,
        scale: ds.typography.scale.filter((s) => s.name !== 'body'),
      },
    });

    expect(fragment).not.toContain('body text the usable box holds');
  });

  it('should give svgs the first icon colour when it describes icons', () => {
    const fragment = renderPromptFragment(load('broadside'));

    expect(fragment).toContain(
      'Give every svg an explicit colour, e.g. `.page svg { color: var(--ds-ink); }`. Never let an icon inherit the text colour.',
    );
  });

  it('should mark a role required when it may sit on any page', () => {
    const ds = load('margin');
    const roles = ds.composition.pageRoles.map((role, i) =>
      i === 1 ? { ...role, required: true } : role,
    );

    const fragment = renderPromptFragment({
      ...ds,
      version: 99,
      composition: { ...ds.composition, pageRoles: roles },
    });

    expect(fragment).toContain('- statement (required):');
  });

  it('should return the memoised fragment when the same version is rendered again', () => {
    const ds = load('broadside');
    const first = renderPromptFragment(ds);

    const second = renderPromptFragment({ ...ds, name: 'Changed' });

    expect(second).toBe(first);
  });

  it('should render a different fragment when the version differs', () => {
    const ds = load('colophon');
    const first = renderPromptFragment(ds);

    const next = renderPromptFragment({ ...ds, version: ds.version + 1 });

    expect(next).not.toBe(first);
    expect(next).toContain(`(colophon v${ds.version + 1})`);
  });
});
