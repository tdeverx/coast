// RGBA8 storage including the mip chain. Active printed faces are never reduced.
export const pageTextureBudget = 192 * 1024 ** 2;
export function pageTextureBytes(width: number, height: number) {
  let bytes = 0;
  for (;;) {
    bytes += width * height * 4;
    if (width === 1 && height === 1) return bytes;
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  }
}

/** Recheck after decoding: both the page's size and its reader ownership may change. */
export function canPreloadPage(sizes: ReadonlyMap<number, number>, required: ReadonlySet<number>, wanted: readonly number[], page: number, bytes: number, budget = pageTextureBudget) {
  if (required.has(page)) return true;
  if (!wanted.includes(page)) return false;
  for (const [index, size] of sizes) if (index !== page) bytes += size;
  return bytes <= budget;
}

/** Required faces may exceed the target; speculation must fit what remains. */
export function budgetedPages(sizes: ReadonlyMap<number, number>, required: ReadonlySet<number>, wanted: readonly number[], budget = pageTextureBudget) {
  const keep = new Set(required);
  let bytes = 0;
  for (const page of required) bytes += sizes.get(page) ?? 0;
  for (const page of wanted) {
    if (keep.has(page)) continue;
    const size = sizes.get(page);
    if (size !== undefined && bytes + size <= budget) {
      keep.add(page);
      bytes += size;
    }
  }
  return keep;
}
