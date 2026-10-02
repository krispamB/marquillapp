import { readFileSync } from 'node:fs';

/** One SVG child element, as `lucide-static` ships it: `[tag, attributes]`. */
export type IconNode = [string, Record<string, string>];

let catalog: ReadonlyMap<string, IconNode[]> | undefined;

/**
 * The pinned icon catalog `app-inline-v1` (§4.5): `lucide-static`, at the exact
 * version in package.json. Loaded on first use, because only seeding and
 * assembly read it.
 */
function iconCatalog(): ReadonlyMap<string, IconNode[]> {
  if (!catalog) {
    const path = require.resolve('lucide-static/icon-nodes.json');
    const nodes = JSON.parse(readFileSync(path, 'utf8')) as Record<
      string,
      IconNode[]
    >;
    catalog = new Map(Object.entries(nodes));
  }
  return catalog;
}

export function isCatalogIcon(name: string): boolean {
  return iconCatalog().has(name);
}

export function catalogIcon(name: string): IconNode[] | undefined {
  return iconCatalog().get(name);
}
