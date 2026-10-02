/**
 * Counts the pages of a PDF that Chromium printed (§5.1 step 8), without a PDF
 * library. Skia writes the page tree uncompressed, so the root `/Pages` node's
 * `/Count` is readable as text, and it is the largest `/Count` in the file
 * (intermediate nodes count a subset). It is checked against the `/Type /Page`
 * objects, so a PDF that ever moves its tree into an object stream fails loudly
 * instead of reporting zero pages.
 */
export function countPdfPages(pdf: Uint8Array): number {
  const text = Buffer.from(pdf).toString('latin1');
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((m) =>
    Number(m[1]),
  );
  const leaves = (text.match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;
  const root = counts.length ? Math.max(...counts) : 0;
  if (root !== leaves || root === 0) {
    throw new Error(
      `unreadable PDF page tree: /Count ${root}, ${leaves} /Page objects`,
    );
  }
  return root;
}
