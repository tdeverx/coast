// Reader indices include covers. Each physical leaf advances two image faces.
export function underPageIndex(page: number, side: number, layer: number, count: number) {
  const next = page + side * layer * 2;
  return page > 1 && page < count - 2 && next > 1 && next < count - 2 ? next : -1;
}
export function reversePageIndex(page: number, side: number, count: number) {
  const reverse = page + side;
  return page > 1 && page < count - 2 && reverse > 1 && reverse < count - 2 ? reverse : -1;
}
export function spreadSheetPages(index: number, count: number) {
  const pages = new Set<number>();
  for (const side of [-1, 1])
    for (const layer of [0, 1, 2]) {
      const top = index + (side > 0 ? 1 : 0), page = layer ? underPageIndex(top, side, layer, count) : top, reverse = reversePageIndex(page, side, count);
      if (reverse >= 0) {
        pages.add(page);
        pages.add(reverse);
      }
    }
  return [...pages];
}
export function nearbyPages(index: number, count: number) {
  return [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6].map((offset: number) => index + offset).filter((page: number) => page >= 0 && page < count);
}
export const sheetPitch = (count: number, depth: number) => depth / Math.max(1, (count - 4) / 2);
export const defaultCurlTargets = Object.freeze([2, 1.4, 1, .9]);
export const defaultWeightMultipliers = Object.freeze([2, 1, .5]); // light, equal, heavy
// A light stack can lift more freely. Equal stacks retain the base preset.
export function stackCurlScale(weight: number, multipliers = defaultWeightMultipliers) {
  const w = Math.max(0, Math.min(1, weight)), i = w <= .5 ? 0 : 1, t = (w - i * .5) * 2, s = t * t * (3 - 2 * t);
  return multipliers[i] * (1 - s) + multipliers[i + 1] * s;
}
export function turningCurlScale(side: number, progress: number, leftWeight: number, multipliers = defaultWeightMultipliers) {
  const start = stackCurlScale(side < 0 ? leftWeight : 1 - leftWeight, multipliers), end = stackCurlScale(side < 0 ? 1 - leftWeight : leftWeight, multipliers);
  return start + (end - start) * progress;
}
// Each value belongs to one layer. Neighbors influence bounds, not multipliers.
export function boundLayerCurls(targets: readonly number[] = defaultCurlTargets) {
  let ceiling = 4;
  return targets.map((target: number) => ceiling = Math.max(0, Math.min(ceiling, target)));
}
export function layerCurl(level: number, targets: readonly number[] = defaultCurlTargets.slice(0, 3)) {
  const curls = boundLayerCurls(targets), at = Math.max(0, Math.min(curls.length - 1, level)), low = Math.floor(at), high = Math.ceil(at);
  return curls[low] + (curls[high] - curls[low]) * (at - low);
}
export function turningLayer(from: number, direction: number, progress: number, stackIndex: number) {
  const target = from + direction * 2;
  return (1 - progress) * Math.max(0, direction * (from - stackIndex) / 2) + progress * Math.max(0, direction * (stackIndex - target) / 2);
}
// One speculative decode at a time. A jump replaces the remaining work rather
// than leaving a queue of obsolete spreads behind it. Required turns load directly.
export class NeighborPreloader {
  wanted: number[] = [];
  attempted = new Set<number>();
  stopped = false;
  paused = false;
  running: Promise<void> | undefined;
  private options: {
    load(page: number): Promise<unknown>;
    has(page: number): boolean;
    onLoad?(page: number): void;
    canLoad?(page: number): boolean;
  };
  constructor(options: NeighborPreloader['options']) {
    this.options = options;
  }
  private has(page: number) {
    return this.options.has(page);
  }
  private load(page: number) {
    return this.options.load(page);
  }
  private onLoad(page: number) {
    this.options.onLoad?.(page);
  }
  warm(pages: number[]): Promise<void> | undefined {
    if (this.stopped)
      return;
    this.wanted = pages;
    this.attempted.clear();
    if (!this.running && !this.paused)
      this.running = this.pump().finally(() => {
        this.running = undefined;
        if (!this.stopped && !this.paused && this.wanted.some((page: number) => !this.has(page) && !this.attempted.has(page)))
          this.warm(this.wanted);
      });
    return this.running;
  }
  async pump() {
    while (!this.stopped && !this.paused) {
      const page = this.wanted.find((page: number) => !this.has(page) && !this.attempted.has(page));
      if (page === undefined)
        return;
      this.attempted.add(page);
      if (this.options.canLoad?.(page) === false) continue;
      try {
        await this.load(page);
        if (!this.stopped)
          this.onLoad(page);
      }
      catch {
      }
    }
  }
  pause(value: boolean) {
    this.paused = value;
    if (!value)
      this.warm(this.wanted);
  }
  stop() {
    this.stopped = true;
    this.wanted = [];
  }
}
