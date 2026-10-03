/** Temporary UI-reference-only effects. These are deliberately outside app presets. */
export const experimentalDefaults = {
  sheenAmount: 0, sheenAngle: 135, sheenSpread: 70,
  vignetteAmount: 0, vignetteSpread: 45,
  edgeAmount: 0, edgeAngle: 135, edgeWidth: 1,
  frostAmount: 0, frostBlur: 8, frostSpread: 70, frostX: 35, frostY: 35,
  interactionAmount: 0, interactionSpread: 65,
};
export type ExperimentalEffects = typeof experimentalDefaults;
export const effectGroups: { title: string; description: string; controls: { key: keyof ExperimentalEffects; label: string; min: number; max: number; step: number; unit: string }[] }[] = [
  { title: 'Directional sheen', description: 'Broad static light over the surface.', controls: [
    { key: 'sheenAmount', label: 'Amount', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'sheenAngle', label: 'Angle', min: 0, max: 360, step: 1, unit: '°' },
    { key: 'sheenSpread', label: 'Spread', min: 1, max: 100, step: 1, unit: '%' },
  ] },
  { title: 'Edge vignette', description: 'Soft darkening towards the perimeter.', controls: [
    { key: 'vignetteAmount', label: 'Amount', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'vignetteSpread', label: 'Spread', min: 1, max: 100, step: 1, unit: '%' },
  ] },
  { title: 'Directional edge light', description: 'A thin rim with adjustable lighting direction.', controls: [
    { key: 'edgeAmount', label: 'Amount', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'edgeAngle', label: 'Angle', min: 0, max: 360, step: 1, unit: '°' },
    { key: 'edgeWidth', label: 'Width', min: .25, max: 8, step: .25, unit: 'px' },
  ] },
  { title: 'Frost variation', description: 'Experimental extra blur in a soft patch; compare performance and both renderers.', controls: [
    { key: 'frostAmount', label: 'Amount', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'frostBlur', label: 'Extra blur', min: 0, max: 30, step: .5, unit: 'px' },
    { key: 'frostSpread', label: 'Spread', min: 10, max: 150, step: 1, unit: '%' },
    { key: 'frostX', label: 'Horizontal position', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'frostY', label: 'Vertical position', min: 0, max: 100, step: 1, unit: '%' },
  ] },
  { title: 'Interaction sheen', description: 'Move over or focus the sample. Touch and reduced motion use a static highlight.', controls: [
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
  return result;
}

type LayerName = 'sheen' | 'vignette' | 'edge' | 'frost' | 'interaction';
export function experimentalMaterial(node: HTMLElement, options: { enabled: boolean; effects: ExperimentalEffects }) {
  const layers = new Map<LayerName, HTMLSpanElement>();
  let base: HTMLSpanElement | undefined;
  function syncBase() {
    if (!base) return;
    // Keep base and patch as siblings: a filtered ancestor would cut the patch's
    // backdrop off at the ancestor (Filter Effects 2, Backdrop Root).
    const filter = node.style.getPropertyValue('backdrop-filter') || 'var(--coast-glass-filter)';
    base.style.setProperty('-webkit-backdrop-filter', filter);
    base.style.setProperty('backdrop-filter', filter);
  }
  const surfaceObserver = new MutationObserver(syncBase);
  surfaceObserver.observe(node, { attributes: true, attributeFilter: ['style'] });
  function frostBase(enabled: boolean) {
    node.classList.toggle('coast-material-frost', enabled);
    if (!enabled) { base?.remove(); base = undefined; return; }
    if (!base) {
      base = document.createElement('span');
      base.dataset.materialEffect = 'base';
      base.setAttribute('aria-hidden', 'true');
      Object.assign(base.style, { position: 'absolute', inset: '0', zIndex: '-2', borderRadius: 'inherit', pointerEvents: 'none', background: 'var(--coast-glass-fill)' });
      node.prepend(base);
    }
    syncBase();
  }
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const touch = matchMedia('(hover: none)');
  let hovering = false, focused = false, x = 50, y = 50, frame = 0;
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
    element.style.background = `radial-gradient(ellipse ${options.effects.interactionSpread}% ${options.effects.interactionSpread}% at ${px}% ${py}%, var(--white), transparent)`;
  }
  function render() {
    const e = options.effects;
    frostBase(options.enabled && e.frostAmount > 0 && e.frostBlur > 0);
    const sheen = layer('sheen', e.sheenAmount);
    if (sheen) sheen.style.background = `linear-gradient(${e.sheenAngle}deg, transparent ${50 - e.sheenSpread / 2}%, var(--white) 50%, transparent ${50 + e.sheenSpread / 2}%)`;
    const vignette = layer('vignette', e.vignetteAmount);
    if (vignette) vignette.style.background = `radial-gradient(closest-side, transparent ${100 - e.vignetteSpread}%, var(--canvas) 100%)`;
    const edge = layer('edge', e.edgeAmount);
    if (edge) Object.assign(edge.style, {
      background: `linear-gradient(${e.edgeAngle}deg, var(--white), transparent 65%)`,
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
    const frost = layer('frost', e.frostAmount);
    if (frost) Object.assign(frost.style, {
      backdropFilter: `blur(${e.frostBlur}px)`, webkitBackdropFilter: `blur(${e.frostBlur}px)`,
      maskImage: `radial-gradient(ellipse ${e.frostSpread}% ${e.frostSpread}% at ${e.frostX}% ${e.frostY}%, black 10%, transparent 100%)`,
    });
    if (frost) frost.style.setProperty('-webkit-mask-image', frost.style.maskImage);
    layer('interaction', e.interactionAmount); interaction();
  }
  function move(event: PointerEvent) {
    if (!options.enabled || options.effects.interactionAmount <= 0 || motion.matches || touch.matches || event.pointerType === 'touch') return;
    hovering = true;
    const box = node.getBoundingClientRect();
    x = Math.max(0, Math.min(100, (event.clientX - box.left) / box.width * 100));
    y = Math.max(0, Math.min(100, (event.clientY - box.top) / box.height * 100));
    cancelAnimationFrame(frame); frame = requestAnimationFrame(interaction);
  }
  const leave = () => { hovering = false; if (focused) { x = 50; y = 50; } interaction(); };
  const focus = () => { focused = true; x = 50; y = 50; interaction(); };
  const blur = (event: FocusEvent) => { if (!node.contains(event.relatedTarget as Node | null)) { focused = false; interaction(); } };
  node.addEventListener('pointermove', move, { passive: true });
  node.addEventListener('pointerleave', leave);
  node.addEventListener('focusin', focus); node.addEventListener('focusout', blur);
  motion.addEventListener('change', interaction); touch.addEventListener('change', interaction);
  render();
  return {
    update(next: typeof options) { options = next; render(); },
    destroy() {
      surfaceObserver.disconnect(); frostBase(false);
      cancelAnimationFrame(frame); for (const element of layers.values()) element.remove(); layers.clear();
      node.removeEventListener('pointermove', move); node.removeEventListener('pointerleave', leave);
      node.removeEventListener('focusin', focus); node.removeEventListener('focusout', blur);
      motion.removeEventListener('change', interaction); touch.removeEventListener('change', interaction);
    },
  };
}
