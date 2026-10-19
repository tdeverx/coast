import { readingTurnBlend } from './view.ts';
export const paperFinish = Object.freeze({ roughness: .9, clearcoat: 0, clearcoatRoughness: .48 });
export const coverFinish = Object.freeze({ roughness: .56, clearcoat: .22, clearcoatRoughness: .48 });
// Stay below both the cover thickness and its clearance above the paper block.
// A larger caster offset pushes the closed block's shadow through its cover.
export const comicShadowNormalBias = .001;
// Zooming the camera must not rotate all the stationary pages into the light.
// Only closing settles the book into its normal closed viewing angle.
export function curlBookRotation(from: number[], progress: number, closing: boolean, tilt: number) {
  if (!closing)
    return [...from];
  const t = readingTurnBlend(progress);
  return [from[0] * (1 - t) - tilt * Math.PI / 180 * t, from[1] * (1 - t), from[2] * (1 - t)];
}
