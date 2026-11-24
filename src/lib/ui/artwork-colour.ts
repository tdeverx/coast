type ColourBucket = { count: number; r: number; g: number; b: number; chroma: number };

function selectColour(pixels: Uint8ClampedArray, weight: (bucket: ColourBucket) => number): string | null {
 const buckets=new Map<number,ColourBucket>();
 for(let i=0;i+3<pixels.length;i+=4){
  const r=pixels[i],g=pixels[i+1],b=pixels[i+2];
  const high=Math.max(r,g,b),low=Math.min(r,g,b);
  if(pixels[i+3]<192||high<32||low>232)continue;
  const key=(r>>5)*64+(g>>5)*8+(b>>5);
  const bucket=buckets.get(key)??{count:0,r:0,g:0,b:0,chroma:0};
  bucket.count++;bucket.r+=r;bucket.g+=g;bucket.b+=b;bucket.chroma+=high-low;buckets.set(key,bucket);
 }
 let selected:ReturnType<typeof buckets.get>,score=0;
 for(const bucket of buckets.values()){
  const rank = weight(bucket);
  if(rank>score){score=rank;selected=bucket;}
 }
 return selected?`rgb(${Math.round(selected.r/selected.count)} ${Math.round(selected.g/selected.count)} ${Math.round(selected.b/selected.count)})`:null;
}

/** Choose a substantial region for a background, ignoring transparent pixels and black/white margins. */
export function prominentColour(pixels: Uint8ClampedArray) {
 return selectColour(pixels, bucket => bucket.count * .5 + bucket.chroma / 255);
}

/** Prefer bright, chromatic accents with enough pixels to exclude isolated highlights. */
export function shimmerColour(pixels: Uint8ClampedArray) {
 return selectColour(pixels, ({ count, r, g, b, chroma }) => {
  const brightness = (.2126 * r + .7152 * g + .0722 * b) / count;
  const averageChroma = chroma / count;
  if (count < 3 || brightness < 96 || averageChroma < 28) return 0;
  return Math.sqrt(count) * (brightness / 255) ** 2 * (averageChroma / 255);
 });
}

function artworkColourAction(property: string, sample: (pixels: Uint8ClampedArray) => string | null) {
  type Listener = (colour: string | null) => void;
  const colours = new Map<string, string | null>();
  const pending = new Map<string, { image: HTMLImageElement; listeners: Set<Listener> }>();

  function subscribe(url: string, listener: Listener) {
    const existing = pending.get(url);
    const job = existing ?? { image: new Image(), listeners: new Set<Listener>() };
    const { image, listeners } = job;
    listeners.add(listener);
    if (!existing) {
      pending.set(url, job);
      const finish = (colour: string | null) => {
        if (pending.get(url) !== job) return;
        pending.delete(url);
        image.onload = image.onerror = null;
        if (colours.size >= 64) colours.delete(colours.keys().next().value!);
        colours.set(url, colour);
        for (const receive of listeners) receive(colour);
        listeners.clear();
      };
      image.crossOrigin = 'anonymous';
      image.referrerPolicy = 'no-referrer';
      image.decoding = 'async';
      image.onload = () => {
        if (pending.get(url) !== job) return;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        let colour: string | null = null;
        try {
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (context) {
            context.drawImage(image, 0, 0, 32, 32);
            colour = sample(context.getImageData(0, 0, 32, 32).data);
          }
        } catch { /* Artwork from a server without CORS uses the next candidate. */ }
        canvas.width = canvas.height = 0;
        finish(colour);
      };
      image.onerror = () => finish(null);
      image.src = url;
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size || pending.get(url) !== job) return;
      pending.delete(url);
      image.onload = image.onerror = null;
      image.removeAttribute('src');
    };
  }

  return (node: HTMLElement, initial: string[]) => {
    let source = '';
    let dispose = () => {};
    function update(candidates: string[]) {
      const urls = [...new Set(candidates)].slice(0, 6);
      const key = JSON.stringify(urls);
      if (key === source) return;
      dispose();
      source = key;
      node.style.removeProperty(property);
      function load(index: number) {
        const url = urls[index];
        if (!url) return;
        const receive: Listener = colour => colour ? node.style.setProperty(property, colour) : load(index + 1);
        if (colours.has(url)) receive(colours.get(url) ?? null);
        else dispose = subscribe(url, receive);
      }
      load(0);
    }
    update(initial);
    return { update, destroy() { dispose(); node.style.removeProperty(property); } };
  };
}
export const artworkColour = artworkColourAction('--artwork-colour', prominentColour);
export const artworkShimmerColour = artworkColourAction('--artwork-shimmer-colour', shimmerColour);
