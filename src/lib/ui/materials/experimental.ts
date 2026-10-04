import { blendModes, type BlendMode } from './presets';

/** Temporary UI-reference-only effects. These are deliberately outside app presets. */
export const experimentalDefaults = {
  sheenAmount: 0, sheenAngle: 135, sheenSpread: 70, sheenPosition: 50, sheenColor: 'var(--white)', sheenBlend: 'normal' as BlendMode,
  vignetteAmount: 0, vignetteSpread: 45, vignetteColor: 'var(--canvas)', vignetteBlend: 'normal' as BlendMode,
  edgeAmount: 0, edgeAngle: 135, edgeWidth: 1, edgeSpread: 65, edgeColor: 'var(--white)', edgeBlend: 'normal' as BlendMode,
  interactionAmount: 0, interactionSpread: 65, interactionColor: 'var(--white)', interactionBlend: 'normal' as BlendMode,
};
export type ExperimentalEffects = typeof experimentalDefaults;
export type EffectColorKey = 'sheenColor' | 'vignetteColor' | 'edgeColor' | 'interactionColor';
export type EffectBlendKey = 'sheenBlend' | 'vignetteBlend' | 'edgeBlend' | 'interactionBlend';
type NumericKey = { [K in keyof ExperimentalEffects]: ExperimentalEffects[K] extends number ? K : never }[keyof ExperimentalEffects];
export const effectGroups: { title: string; description: string; color: EffectColorKey; blend: EffectBlendKey; controls: { key: NumericKey; label: string; min: number; max: number; step: number; unit: string }[] }[] = [
  { title: 'Directional sheen', description: 'Broad static light over the surface.', color: 'sheenColor', blend: 'sheenBlend', controls: [
    { key: 'sheenAmount', label: 'Amount', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'sheenAngle', label: 'Angle', min: 0, max: 360, step: 1, unit: '°' },
    { key: 'sheenPosition', label: 'Position', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'sheenSpread', label: 'Spread', min: 1, max: 100, step: 1, unit: '%' },
  ] },
  { title: 'Edge vignette', description: 'Soft darkening towards the perimeter.', color: 'vignetteColor', blend: 'vignetteBlend', controls: [
    { key: 'vignetteAmount', label: 'Amount', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'vignetteSpread', label: 'Spread', min: 1, max: 100, step: 1, unit: '%' },
  ] },
  { title: 'Directional edge light', description: 'A thin rim with adjustable lighting direction.', color: 'edgeColor', blend: 'edgeBlend', controls: [
    { key: 'edgeAmount', label: 'Amount', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'edgeAngle', label: 'Angle', min: 0, max: 360, step: 1, unit: '°' },
    { key: 'edgeSpread', label: 'Fade extent', min: 1, max: 100, step: 1, unit: '%' },
    { key: 'edgeWidth', label: 'Width', min: .25, max: 8, step: .25, unit: 'px' },
  ] },
  { title: 'Interaction sheen', description: 'Move over or focus the sample. Touch and reduced motion use a static highlight.', color: 'interactionColor', blend: 'interactionBlend', controls: [
    { key: 'interactionAmount', label: 'Amount', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'interactionSpread', label: 'Spread', min: 10, max: 150, step: 1, unit: '%' },
  ] },
];
export function readExperimentalEffects(value: unknown): ExperimentalEffects {
  const result = { ...experimentalDefaults };
  if (!value || typeof value !== 'object') return result;
  for (const { controls } of effectGroups) for (const { key, min, max } of controls) {
    const number = (value as Record<string, unknown>)[key];
    if (typeof number === 'number' && Number.isFinite(number)) result[key] = Math.min(max, Math.max(min, number));
  }
  for (const { color, blend } of effectGroups) {
    const fields = value as Record<string, unknown>;
    if (typeof fields[color] === 'string' && fields[color].length <= 200) result[color] = fields[color];
    if (blendModes.includes(fields[blend] as BlendMode)) result[blend] = fields[blend] as BlendMode;
  }
  return result;
}

type LayerName = 'sheen' | 'vignette' | 'edge' | 'interaction';
export function experimentalMaterial(node: HTMLElement, options: { enabled: boolean; effects: ExperimentalEffects }) {
  const layers = new Map<LayerName, HTMLSpanElement>();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const touch = matchMedia('(hover: none)');
  let hovering = false, focused = false, x = 50, y = 50, frame = 0;
  let pointer: {x:number;y:number}|undefined;
  function layer(name: LayerName, amount: number) {
    if (!options.enabled || amount <= 0) { layers.get(name)?.remove(); layers.delete(name); return; }
    let element = layers.get(name);
    if (!element) {
      element = document.createElement('span');
      element.dataset.materialEffect = name;
      element.setAttribute('aria-hidden', 'true');
      Object.assign(element.style, { position: 'absolute', inset: '0', zIndex: '-1', borderRadius: 'inherit', pointerEvents: 'none' });
      node.append(element); layers.set(name, element);
    }
    element.style.opacity = `${amount / 100}`;
    return element;
  }
  function interaction() {
    const element = layers.get('interaction'); if (!element) return;
    const active = motion.matches || touch.matches || hovering || focused;
    element.style.opacity = active ? `${options.effects.interactionAmount / 100}` : '0';
    const px = motion.matches || touch.matches ? 50 : x;
    const py = motion.matches || touch.matches ? 50 : y;
    element.style.background = `radial-gradient(ellipse ${options.effects.interactionSpread}% ${options.effects.interactionSpread}% at ${px}% ${py}%, ${options.effects.interactionColor}, transparent)`;
  }
  function render() {
    const e = options.effects;
    const sheen = layer('sheen', e.sheenAmount);
    if (sheen) sheen.style.background = `linear-gradient(${e.sheenAngle}deg, transparent ${e.sheenPosition - e.sheenSpread / 2}%, ${e.sheenColor} ${e.sheenPosition}%, transparent ${e.sheenPosition + e.sheenSpread / 2}%)`;
    const vignette = layer('vignette', e.vignetteAmount);
    if (vignette) vignette.style.background = `radial-gradient(closest-side, transparent ${100 - e.vignetteSpread}%, ${e.vignetteColor} 100%)`;
    const edge = layer('edge', e.edgeAmount);
    if (edge) Object.assign(edge.style, {
      background: `linear-gradient(${e.edgeAngle}deg, ${e.edgeColor}, transparent ${e.edgeSpread}%)`,
      padding: `${e.edgeWidth}px`,
      maskImage: 'linear-gradient(black, black), linear-gradient(black, black)',
      maskClip: 'content-box, border-box', maskComposite: 'exclude',
    });
    if (edge) {
      edge.style.setProperty('-webkit-mask-image', 'linear-gradient(black, black), linear-gradient(black, black)');
      edge.style.setProperty('-webkit-mask-clip', 'content-box, border-box');
      edge.style.setProperty('-webkit-mask-composite', 'xor');
      edge.style.maskComposite = 'exclude';
    }
    layer('interaction', e.interactionAmount);
    for (const name of ['sheen', 'vignette', 'edge', 'interaction'] as const) {
      const element = layers.get(name);
      if (element) element.style.mixBlendMode = e[`${name}Blend`];
    }
    interaction();
  }
  function move(event: PointerEvent) {
    if (!options.enabled || options.effects.interactionAmount <= 0 || motion.matches || touch.matches || event.pointerType === 'touch') return;
    hovering = true;
    pointer = {x:event.clientX,y:event.clientY};
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      if (!pointer) return;
      const box = node.getBoundingClientRect();
      x = Math.max(0, Math.min(100, (pointer.x - box.left) / Math.max(1,box.width) * 100));
      y = Math.max(0, Math.min(100, (pointer.y - box.top) / Math.max(1,box.height) * 100));
      pointer = undefined;
      interaction();
    });
  }
  const cancelPointer = () => {cancelAnimationFrame(frame);frame=0;pointer=undefined;};
  const leave = () => { cancelPointer(); hovering = false; if (focused) { x = 50; y = 50; } interaction(); };
  const focus = () => { focused = true; x = 50; y = 50; interaction(); };
  const blur = (event: FocusEvent) => { if (!node.contains(event.relatedTarget as Node | null)) { focused = false; interaction(); } };
  node.addEventListener('pointermove', move, { passive: true });
  node.addEventListener('pointerleave', leave);
  node.addEventListener('focusin', focus); node.addEventListener('focusout', blur);
  motion.addEventListener('change', interaction); touch.addEventListener('change', interaction);
  render();
  return {
    update(next: typeof options) { cancelPointer(); options = next; render(); },
    destroy() {
      cancelPointer(); for (const element of layers.values()) element.remove(); layers.clear();
      node.removeEventListener('pointermove', move); node.removeEventListener('pointerleave', leave);
      node.removeEventListener('focusin', focus); node.removeEventListener('focusout', blur);
      motion.removeEventListener('change', interaction); touch.removeEventListener('change', interaction);
    },
  };
}
