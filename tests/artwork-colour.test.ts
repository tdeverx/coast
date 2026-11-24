import {expect,test} from 'bun:test';
import {prominentColour,shimmerColour,artworkColour} from '../src/lib/ui/artwork-colour';
const pixels=(groups:{rgb:number[];count:number}[])=>new Uint8ClampedArray(groups.flatMap(group=>Array.from({length:group.count},()=>group.rgb).flat()));
test('artwork tint ignores transparent and black/white margins and chooses a substantial colour region',()=>{
 expect(prominentColour(pixels([{rgb:[0,0,0,255],count:50},{rgb:[255,255,255,255],count:50},{rgb:[0,240,0,0],count:50},{rgb:[40,80,140,255],count:40},{rgb:[255,0,0,255],count:2}]))).toBe('rgb(40 80 140)');
 expect(prominentColour(pixels([{rgb:[0,0,0,255],count:10},{rgb:[255,255,255,255],count:10}]))).toBeNull();
});
test('nearby artwork colours combine in one region and greyscale artwork remains neutral',()=>{
 expect(prominentColour(pixels([{rgb:[64,128,192,255],count:10},{rgb:[72,136,200,255],count:10}]))).toBe('rgb(68 132 196)');
 expect(prominentColour(pixels([{rgb:[96,96,96,255],count:10}]))).toBe('rgb(96 96 96)');
 expect(prominentColour(new Uint8ClampedArray())).toBeNull();
});
test('shimmer sampling favours bright accents over dominant dark colours', () => {
 const dark = { rgb: [64, 32, 64, 255], count: 120 };
 const bright = { rgb: [234, 149, 64, 255], count: 12 };
 const neutral = { rgb: [210, 208, 205, 255], count: 50 };
 const stray = { rgb: [240, 220, 40, 255], count: 2 };
 expect(prominentColour(pixels([dark, bright, neutral, stray]))).toBe('rgb(64 32 64)');
 expect(shimmerColour(pixels([dark, bright, neutral, stray]))).toBe('rgb(234 149 64)');
 expect(shimmerColour(pixels([dark, neutral, stray]))).toBeNull();
});
test('artwork fallback is sequential, cached and cannot repaint a replaced or destroyed detail',()=>{
 const originalImage=globalThis.Image,originalDocument=globalThis.document;
 const images:{src:string;onload:(()=>void)|null;onerror:(()=>void)|null;removeAttribute:()=>void}[]=[];
 const properties=new Map<string,string>();
 const node={style:{setProperty:(key:string,value:string)=>properties.set(key,value),removeProperty:(key:string)=>properties.delete(key)}} as unknown as HTMLElement;
 globalThis.Image=class {src='';onload=null;onerror=null;constructor(){images.push(this);}removeAttribute(){this.src='';}} as unknown as typeof Image;
 globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({drawImage(){},getImageData:()=>({data:pixels([{rgb:[50,90,140,255],count:10}])})})})} as unknown as Document;
 try{
  const action=artworkColour(node,['/first-test-image','/second-test-image']);
  expect(images).toHaveLength(1);images[0].onerror?.();expect(images).toHaveLength(2);
  const otherProperties=new Map<string,string>();
  const otherNode={style:{setProperty:(key:string,value:string)=>otherProperties.set(key,value),removeProperty:(key:string)=>otherProperties.delete(key)}} as unknown as HTMLElement;
  const other=artworkColour(otherNode,['/second-test-image']);
  expect(images).toHaveLength(2);
  images[1].onload?.();expect(properties.get('--artwork-colour')).toBe('rgb(50 90 140)');
  expect(otherProperties.get('--artwork-colour')).toBe('rgb(50 90 140)');
  other.destroy();
  action.update(['/stale-test-image']);const stale=images[2].onload;
  action.update(['/fresh-test-image']);stale?.();expect(properties.has('--artwork-colour')).toBe(false);
  images[3].onload?.();expect(properties.get('--artwork-colour')).toBe('rgb(50 90 140)');
  action.update(['/first-test-image','/second-test-image']);expect(images).toHaveLength(4);
  action.destroy();expect(properties.has('--artwork-colour')).toBe(false);expect(images[3].onload).toBeNull();
 }finally{globalThis.Image=originalImage;globalThis.document=originalDocument;}
});
