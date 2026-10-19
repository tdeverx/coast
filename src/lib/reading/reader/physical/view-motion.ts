export const defaultViewTilts = Object.freeze({ closed: 20, open: 10, reading: 0 });
// The caller eases one timeline: rise and facing stay concurrent; covers stay shut.
export function bookEntrancePose(progress: number, travel: number, closedTilt: number = defaultViewTilts.closed) {
  const t = Math.max(0, Math.min(1, progress));
  return { y: -travel * (1 - t), rotation: [-closedTilt * Math.PI / 180, Math.PI * (1 - t), 0] };
}
