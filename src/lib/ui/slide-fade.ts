import { slide } from 'svelte/transition';

export function slideFade(node: Element) {
  const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240;
  const motion = slide(node, { duration });
  // Fade over the full height animation.
  return { ...motion, css: (t: number, u: number) => `${motion.css?.(t, u) ?? ''}; opacity: ${t};` };
}
