import { glassPresets, type GlassVariant } from './presets';
const SVG_NS = 'http://www.w3.org/2000/svg';

export type LiquidGlassOptions = {
  variant?: GlassVariant;
  enabled?: boolean;
};

let filterSequence = 0;
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));
function smoothstep(edge0: number, edge1: number, value: number) {
  const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}
function svgElement<TagName extends keyof SVGElementTagNameMap>(name: TagName) {
  return document.createElementNS(SVG_NS, name);
}
function displacementMap(
  width: number,
  height: number,
  padding: number,
  radius: number,
  depth: number
) {
  const canvas = document.createElement('canvas');
  canvas.width = width + padding * 2;
  canvas.height = height + padding * 2;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const image = context.createImageData(canvas.width, canvas.height);
  const halfWidth = width / 2,
    halfHeight = height / 2;
  const edgeBand = Math.min(depth / 2, height * 0.3);
  for (let y = 0; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++) {
      const index = (y * canvas.width + x) * 4;
      const localX = x - padding - halfWidth,
        localY = y - padding - halfHeight;
      let red = 128,
        blue = 128;
      if (x >= padding && x <= width + padding && y >= padding && y <= height + padding) {
        const cornerX = Math.abs(localX) - (halfWidth - radius);
        const cornerY = Math.abs(localY) - (halfHeight - radius);
        const distance =
          Math.hypot(Math.max(cornerX, 0), Math.max(cornerY, 0)) +
          Math.min(Math.max(cornerX, cornerY), 0) -
          radius;
        if (distance <= 0) {
          const strength = 1 - smoothstep(0, edgeBand, -distance);
          const nx = localX / Math.max(halfWidth, 1),
            ny = localY / Math.max(halfHeight, 1);
          const magnitude = Math.hypot(nx, ny) || 1;
          red = 128 + (nx / magnitude) * 112 * strength;
          blue = 128 + (ny / magnitude) * 112 * strength;
        }
      }
      image.data[index] = clamp(Math.round(red), 0, 255);
      image.data[index + 1] = 128;
      image.data[index + 2] = clamp(Math.round(blue), 0, 255);
      image.data[index + 3] = 255;
    }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}
function addChannel(filter: SVGFilterElement, input: string, result: string, matrix: string) {
  const channel = svgElement('feColorMatrix');
  channel.setAttribute('in', input);
  channel.setAttribute('type', 'matrix');
  channel.setAttribute('values', matrix);
  channel.setAttribute('result', result);
  filter.append(channel);
}
function supported() {
  const declaresSvgBackdrop =
    CSS.supports('backdrop-filter', 'url("#coast-liquid-glass-support-test")') ||
    CSS.supports('-webkit-backdrop-filter', 'url("#coast-liquid-glass-support-test")');
  if (!declaresSvgBackdrop) return false;

  // Gecko accepts the syntax, and supports some SVG backdrop filters, but it
  // still ignores filters such as Coast's when feImage supplies the generated
  // displacement map (Mozilla bug 1961378). Do not let that false-positive
  // replace the working CSS frost fallback with an invisible filter.
  const isGecko =
    /Gecko\//.test(navigator.userAgent) && !/(Chrome|Chromium|Edg)\//.test(navigator.userAgent);
  return !isGecko;
}

/** The hard-pinned Coast SVG backdrop material. Unsupported browsers retain stylesheet frost. */
export function liquidGlass(node: HTMLElement, requested: boolean | LiquidGlassOptions = true) {
  const nativeSupported = supported();
  const filterId = `coast-liquid-glass-${Date.now()}-${++filterSequence}`;
  let frame = 0,
    definition: SVGSVGElement | null = null;
  const settings = () => {
    const options = typeof requested === 'boolean' ? { enabled: requested } : requested;
    const preset = glassPresets.materials[options.variant ?? 'clear'];
    return {
      ...preset,
      refraction: preset.refraction,
      depth: preset.depth,
      dispersion: preset.dispersion,
      radius: preset.blur,
      saturation: preset.saturation / 100,
      brightness: preset.brightness / 100,
      ...options,
    };
  };
  const materialProperties = new Set<string>();
  function applySurface(enhanced: boolean) {
    const variant = settings().variant ?? 'clear';
    const surface = glassPresets[enhanced ? 'materials' : 'fallbacks'][variant];
    node.dataset.coastGlassVariant = variant;
    const values = {
      fill: `color-mix(in srgb, ${surface.tint} ${surface.fillOpacity}%, transparent)`,
      filter: `blur(${surface.blur}px) saturate(${surface.saturation}%) brightness(${surface.brightness}%)`,
      stroke: surface.strokeColor,
      'stroke-opacity': `${surface.strokeOpacity}%`,
      'stroke-inner-width': `${surface.strokeAlignment === 'internal' ? surface.strokeWidth : 0}px`,
      'stroke-outer-width': `${surface.strokeAlignment === 'external' ? surface.strokeWidth : 0}px`,
      'top-inner-color': surface.topInnerColor,
      'top-inner-depth': `${surface.topInnerWidth}px`,
      'top-inner-opacity': `${surface.topInnerOpacity}%`,
      'top-inner-softness': `${surface.topInnerSoftness}px`,
      'bottom-inner-color': surface.bottomInnerColor,
      'bottom-inner-depth': `${surface.bottomInnerWidth}px`,
      'bottom-inner-opacity': `${surface.bottomInnerOpacity}%`,
      'bottom-inner-softness': `${surface.bottomInnerSoftness}px`,
      shadow: `0 0 0 ${surface.strokeAlignment === 'external' ? surface.strokeWidth : 0}px color-mix(in srgb, ${surface.strokeColor} ${surface.strokeOpacity}%, transparent), ${surface.shadowOffsetX}px ${surface.shadowOffsetY}px 0.9375rem color-mix(in srgb, var(--canvas) ${surface.shadowOpacity}%, transparent)`,
    };
    for (const [key, value] of Object.entries(values)) {
      const property = `--coast-glass-${key}`;
      node.style.setProperty(property, value);
      materialProperties.add(property);
    }
  }
  function clearNative(state: string) {
    node.style.removeProperty('-webkit-backdrop-filter');
    node.style.removeProperty('backdrop-filter');
    node.classList.remove('liquid-glass-active');
    node.dataset.coastGlassRenderer = state;
    applySurface(false);
    definition?.remove();
    definition = null;
  }
  function render() {
    const options = settings();
    const enabled =
      nativeSupported &&
      options.refraction > 0 &&
      options.enabled !== false &&
      document.querySelector('[data-coast-glass="on"]');
    if (!enabled) {
      clearNative(!nativeSupported || options.refraction === 0 ? 'css' : 'disabled');
      return;
    }
    const width = Math.round(node.offsetWidth),
      height = Math.round(node.offsetHeight);
    if (!width || !height) return;
    const scale = -(options.depth * 2 * options.refraction);
    const dispersion = options.depth * options.dispersion;
    const padding = Math.ceil((Math.abs(scale) + dispersion) / 2) + 8;
    const computedRadius = Number.parseFloat(getComputedStyle(node).borderTopLeftRadius);
    const radius = Math.min(
      Number.isFinite(computedRadius) ? computedRadius : height / 2,
      width / 2,
      height / 2
    );
    const mapUrl = displacementMap(width, height, padding, radius, options.depth);
    if (!mapUrl) {
      clearNative('css');
      return;
    }
    definition?.remove();
    const svg = svgElement('svg');
    Object.assign(svg.style, { position: 'fixed', width: '0', height: '0', pointerEvents: 'none' });
    svg.setAttribute('aria-hidden', 'true');
    const filter = svgElement('filter');
    filter.id = filterId;
    for (const [key, value] of Object.entries({
      filterUnits: 'objectBoundingBox',
      primitiveUnits: 'userSpaceOnUse',
      x: '-50%',
      y: '-50%',
      width: '200%',
      height: '200%',
      'color-interpolation-filters': 'sRGB',
    }))
      filter.setAttribute(key, value);
    const image = svgElement('feImage');
    for (const [key, value] of Object.entries({
      href: mapUrl,
      x: `${-padding}`,
      y: `${-padding}`,
      width: `${width + padding * 2}`,
      height: `${height + padding * 2}`,
      preserveAspectRatio: 'none',
      result: 'map',
    }))
      image.setAttribute(key, value);
    filter.append(image);
    ['red', 'green', 'blue'].forEach((channel, index) => {
      const displacement = svgElement('feDisplacementMap');
      for (const [key, value] of Object.entries({
        in: 'SourceGraphic',
        in2: 'map',
        scale: `${scale + [0, dispersion / 2, dispersion][index]}`,
        xChannelSelector: 'R',
        yChannelSelector: 'B',
        result: `${channel}-displaced`,
      }))
        displacement.setAttribute(key, value);
      filter.append(displacement);
    });
    addChannel(filter, 'red-displaced', 'red', '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0');
    addChannel(filter, 'green-displaced', 'green', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0');
    addChannel(filter, 'blue-displaced', 'blue', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0');
    const rg = svgElement('feBlend');
    rg.setAttribute('in', 'red');
    rg.setAttribute('in2', 'green');
    rg.setAttribute('mode', 'screen');
    rg.setAttribute('result', 'red-green');
    filter.append(rg);
    const composite = svgElement('feBlend');
    composite.setAttribute('in', 'red-green');
    composite.setAttribute('in2', 'blue');
    composite.setAttribute('mode', 'screen');
    composite.setAttribute('result', 'composite');
    filter.append(composite);
    const blur = svgElement('feGaussianBlur');
    blur.setAttribute('in', 'composite');
    blur.setAttribute('stdDeviation', `${options.radius}`);
    filter.append(blur);
    svg.append(filter);
    document.body.append(svg);
    definition = svg;
    const value = `url("#${filterId}") saturate(${options.saturation}) brightness(${options.brightness})`;
    node.style.setProperty('-webkit-backdrop-filter', value);
    node.style.setProperty('backdrop-filter', value);
    applySurface(true);
    node.classList.add('liquid-glass-active');
    node.dataset.coastGlassRenderer = 'original-svg-backdrop';
  }
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  };
  const resize = new ResizeObserver(schedule),
    setting = new MutationObserver(schedule);
  resize.observe(node);
  const root = document.querySelector('[data-coast-glass]');
  if (root) setting.observe(root, { attributes: true, attributeFilter: ['data-coast-glass'] });
  applySurface(false);
  render();
  return {
    update(next: boolean | LiquidGlassOptions = true) {
      requested = next;
      schedule();
    },
    destroy() {
      cancelAnimationFrame(frame);
      resize.disconnect();
      setting.disconnect();
      node.style.removeProperty('-webkit-backdrop-filter');
      node.style.removeProperty('backdrop-filter');
      node.classList.remove('liquid-glass-active');
      delete node.dataset.coastGlassRenderer;
      delete node.dataset.coastGlassVariant;
      for (const property of materialProperties) node.style.removeProperty(property);
      const stale = definition;
      definition = null;
      setTimeout(() => requestAnimationFrame(() => stale?.remove()), 500);
    },
  };
}
