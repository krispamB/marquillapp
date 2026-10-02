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
