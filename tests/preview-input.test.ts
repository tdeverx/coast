import {expect,test} from 'bun:test';
import sharp from 'sharp';
import {parsePreviewJson,previewJson,previewEvent,previewImageDimensions,previewInputLimits} from '../src/lib/ui/preview-input';

test('complete configuration admission preserves accepted data and exact UTF-8 byte limits',()=>{
 const input={a:'x'.repeat(previewInputLimits.jsonBytes-8)};const text=JSON.stringify(input);expect(text.length).toBe(previewInputLimits.jsonBytes);
 expect(previewJson(input)).toBe(text);expect(parsePreviewJson(text)).toEqual(input);
 expect(()=>previewJson({a:input.a+'x'})).toThrow('1 MiB');
 expect(()=>parsePreviewJson(JSON.stringify({a:'😀'.repeat(300000)}))).toThrow('1 MiB');
 expect(()=>previewJson({a:input.a},2)).toThrow('1 MiB');
});
test('bounded validation rejects excessive arrays, nesting, values and cycles without rejecting aliases',()=>{
 expect(()=>previewJson(Array(1001).fill(1))).toThrow('1,000');
 let nested:unknown=1;for(let i=0;i<34;i++)nested={nested};expect(()=>previewJson(nested)).toThrow('32');
 expect(()=>previewJson(Object.fromEntries(Array.from({length:10001},(_,i)=>[i,1])))).toThrow('10,000');
 const a:any={};a.cycle=a;expect(()=>previewJson(a)).toThrow('circular');
 const shared={value:1};expect(previewJson({a:shared,b:shared})).toBe('{"a":{"value":1},"b":{"value":1}}');
});
test('bounded callback previews handle cycles/getters and mark omitted data without reading entire argument graphs',()=>{
 let read=0;const graph:any={huge:'a'.repeat(1_000_000)};graph.self=graph;Object.defineProperty(graph,'getter',{enumerable:true,get(){read++;throw Error('must not run');}});
 const text=previewEvent([graph,...Array(1000).fill('large'.repeat(1000))]);expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(4096);expect(text).toContain('preview shortened');expect(read).toBe(0);
 expect(previewEvent([new Event('change')])).toBe('[{"type":"change"}]');
});
test('real shipped pixels retain their header dimensions across supported PNG/JPEG/WebP encodings',async()=>{
 const original=await Bun.file('static/coast-mark.png').bytes(),metadata=await sharp(original).metadata();
 for(const format of ['png','jpeg','webp']as const){const bytes=format==='png'?original:await sharp(original).toFormat(format).toBuffer();expect(previewImageDimensions(bytes)).toEqual({width:metadata.width,height:metadata.height,format});}
});
test('oversized and animated metadata is rejected before decoder admission',async()=>{
 const png=new Uint8Array(await Bun.file('static/coast-mark.png').bytes());new DataView(png.buffer).setUint32(16,9000);expect(()=>previewImageDimensions(png)).toThrow('8,192');
 expect(()=>previewImageDimensions(new TextEncoder().encode('<svg width="1" height="1"/>'))).toThrow('static PNG');
 // Authored animation metadata is rejected even without a decodable frame.
 const animated=new Uint8Array(30),view=new DataView(animated.buffer);animated.set(new TextEncoder().encode('RIFF'));view.setUint32(4,22,true);animated.set(new TextEncoder().encode('WEBPVP8X'),8);view.setUint32(16,10,true);animated[20]=2;
 expect(()=>previewImageDimensions(animated)).toThrow('animated');
 const source=await Bun.file('static/coast-mark.png').bytes(),apng=new Uint8Array(source.length+12);apng.set(source.slice(0,33));apng.set(new TextEncoder().encode('acTL'),37);apng.set(source.slice(33),45);expect(()=>previewImageDimensions(apng)).toThrow('animated');
 expect(()=>previewImageDimensions(png.slice(0,25))).toThrow();
});
