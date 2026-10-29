export const previewInputLimits={jsonBytes:1_048_576,depth:32,values:10_000,arrayEntries:1_000,eventBytes:4_096,imageBytes:10*1024*1024,imagePixels:16_000_000,imageSide:8_192} as const;
const encoder=new TextEncoder();
function bytes(text:string){return encoder.encode(text).length;}
/** Bound structure before serialization, including aggregate configuration size.
 * Ancestor tracking rejects cycles without rejecting shared non-cyclic values. */
export function previewJson(value:unknown,space?:number):string {
  let count=0,size=0;
  const ancestors=new WeakSet<object>(),stack:{value:unknown;depth:number;leave?:boolean}[]=[{value,depth:0}];
  const add=(text:string)=>{if(text.length>previewInputLimits.jsonBytes||(size+=bytes(text))>previewInputLimits.jsonBytes)throw Error('Preview configuration must be 1 MiB or smaller.');};
  while(stack.length){
    const item=stack.pop()!,value=item.value;
    if(item.leave){ancestors.delete(value as object);continue;}
    if(++count>previewInputLimits.values)throw Error('Preview configuration exceeds 10,000 values.');
    if(item.depth>previewInputLimits.depth)throw Error('Preview configuration exceeds 32 nesting levels.');
    if(value===null||typeof value!=='object'){const token=JSON.stringify(value);if(token!==undefined)add(token);continue;}
    if(value instanceof Date){add(JSON.stringify(value));continue;}
    if(ancestors.has(value))throw Error('Preview configuration cannot contain circular values.');
    ancestors.add(value);stack.push({value,depth:item.depth,leave:true});add('{}');
    if(Array.isArray(value)){
      if(value.length>previewInputLimits.arrayEntries)throw Error('Preview arrays must contain at most 1,000 entries.');
      if(value.length>1)add(','.repeat(value.length-1));
      for(let i=value.length-1;i>=0;i--)stack.push({value:value[i]===undefined?null:value[i],depth:item.depth+1});
    }else{
      let entries=0;
      for(const key in value)if(Object.hasOwn(value,key)){
        if(count+stack.length>previewInputLimits.values*2)throw Error('Preview configuration exceeds 10,000 values.');
        const property=Object.getOwnPropertyDescriptor(value,key)!;
        if(property.get||property.set)throw Error('Preview configuration must contain plain data.');
        if(property.value===undefined||typeof property.value==='function'||typeof property.value==='symbol')continue;
        add((entries++?',':'')+JSON.stringify(key)+':');stack.push({value:property.value,depth:item.depth+1});
      }
    }
  }
  const text=JSON.stringify(value,null,space);
  if(text===undefined)throw Error('Supply JSON data.');
  if(text.length>previewInputLimits.jsonBytes||bytes(text)>previewInputLimits.jsonBytes)throw Error('Preview configuration must be 1 MiB or smaller.');
  return text;
}
export function parsePreviewJson(text:string):unknown {
  if(text.length>previewInputLimits.jsonBytes||bytes(text)>previewInputLimits.jsonBytes)throw Error('Preview configuration must be 1 MiB or smaller.');
  const value=JSON.parse(text);previewJson(value);return value;
}
/** Project finite display data first. Never serialize complete callback graphs. */
export function previewEvent(args:unknown[]):string {
  let visited=0,shortened=false;
  const ancestors=new WeakSet<object>();
  function project(value:unknown,depth:number):unknown {
    if(++visited>100||depth>4){shortened=true;return '[omitted]';}
    if(typeof Event!=='undefined'&&value instanceof Event)return {type:value.type};
    if(typeof value==='string'){if(value.length>512)shortened=true;return value.slice(0,512);}
    if(value===null||typeof value==='boolean'||typeof value==='number')return value;
    if(typeof value!=='object')return String(value).slice(0,128);
    if(ancestors.has(value)){shortened=true;return '[circular]';}
    ancestors.add(value);
    try{
      if(Array.isArray(value)){if(value.length>20)shortened=true;return value.slice(0,20).map(item=>project(item,depth+1));}
      const result:Record<string,unknown>={};let keys=0;
      for(const key in value)if(Object.hasOwn(value,key)){
        if(++keys>20||visited>=100){shortened=true;break;}
        const property=Object.getOwnPropertyDescriptor(value,key)!;
        if(key.length>128)shortened=true;
        Object.defineProperty(result,key.slice(0,128),{value:property.get?'[accessor]':project(property.value,depth+1),enumerable:true});
      }
      return result;
    }finally{ancestors.delete(value);}
  }
  const text=JSON.stringify(project(args,0)),encoded=encoder.encode(text),marker='\n[preview shortened]';
  if(encoded.length>previewInputLimits.eventBytes-64){shortened=true;return new TextDecoder().decode(encoded.subarray(0,previewInputLimits.eventBytes-64))+marker;}
  return text+(shortened?marker:'');
}
function admitted(width:number,height:number) {
  if(!width||!height||width>previewInputLimits.imageSide||height>previewInputLimits.imageSide||width*height>previewInputLimits.imagePixels)
    throw Error('Choose a background up to 16 megapixels and 8,192 pixels per side.');
  return {width,height};
}
/** Header admission runs before any URL or native decoder is admitted. */
export function previewImageDimensions(bytes:Uint8Array) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),text=(at:number,n:number)=>String.fromCharCode(...bytes.subarray(at,at+n));
  const bad=()=>new Error('Choose a valid static PNG, JPEG or WebP background.');
  if(bytes.length>=24&&[137,80,78,71,13,10,26,10].every((x,i)=>bytes[i]===x)){
    if(text(12,4)!=='IHDR'||view.getUint32(8)!==13)throw bad();
    const size=admitted(view.getUint32(16),view.getUint32(20));let offset=8,ended=false;
    while(offset+12<=bytes.length){const length=view.getUint32(offset),kind=text(offset+4,4);if(kind==='IHDR'&&offset!==8)throw bad();if(length>bytes.length-offset-12)throw bad();if(kind==='acTL')throw Error('Choose a static background; animated images are not supported.');offset+=length+12;if(kind==='IEND'){ended=true;break;}}
    if(!ended)throw bad();return {...size,format:'png' as const};
  }
  if(bytes[0]===255&&bytes[1]===216){
    let offset=2,size:ReturnType<typeof admitted>|undefined;
    while(offset+4<=bytes.length){
      if(bytes[offset++]!==255)throw bad();while(bytes[offset]===255)offset++;
      const marker=bytes[offset++];if(marker===218){if(!size)throw bad();return {...size,format:'jpeg' as const};}
      if(marker===217)break;if(marker===1||marker>=208&&marker<=215)continue;
      if(offset+2>bytes.length)throw bad();const length=view.getUint16(offset);if(length<2||length>bytes.length-offset)throw bad();
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){
        if(size||![192,193,194].includes(marker)||length<8)throw bad();size=admitted(view.getUint16(offset+5),view.getUint16(offset+3));
      }
      offset+=length;
    }
    throw bad();
  }
  if(bytes.length>=20&&text(0,4)==='RIFF'&&text(8,4)==='WEBP'){
    if(view.getUint32(4,true)+8!==bytes.length)throw bad();
    let offset=12,canvas:ReturnType<typeof admitted>|undefined,frame:ReturnType<typeof admitted>|undefined;
    const u24=(at:number)=>bytes[at]|bytes[at+1]<<8|bytes[at+2]<<16;
    while(offset+8<=bytes.length){const kind=text(offset,4),length=view.getUint32(offset+4,true),start=offset+8;if(length>bytes.length-start)throw bad();
      if(kind==='ANIM'||kind==='ANMF')throw Error('Choose a static background; animated images are not supported.');
      if(kind==='VP8X'){if(canvas||length<10)throw bad();if(bytes[start]&2)throw Error('Choose a static background; animated images are not supported.');canvas=admitted(u24(start+4)+1,u24(start+7)+1);}
      if(kind==='VP8 '){if(frame||length<10||text(start+3,3)!=='\x9d\x01\x2a')throw bad();frame=admitted(view.getUint16(start+6,true)&16383,view.getUint16(start+8,true)&16383);}
      if(kind==='VP8L'){if(frame||length<5||bytes[start]!==47)throw bad();const bits=view.getUint32(start+1,true);frame=admitted((bits&16383)+1,((bits>>>14)&16383)+1);}
      offset=start+length+(length%2);
    }
    if(!frame||offset!==bytes.length||canvas&&(frame.width>canvas.width||frame.height>canvas.height))throw bad();
    return {...(canvas??frame),format:'webp' as const};
  }
  throw bad();
}
async function inspectImage(file:File) {
  if(file.size>previewInputLimits.imageBytes)throw Error('Choose a background of 10 MiB or smaller.');
  return previewImageDimensions(new Uint8Array(await file.arrayBuffer()));
}
function decode(url:string,signal:AbortSignal) {
  const image=new Image();
  const abort=()=>{image.src='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';};
  signal.addEventListener('abort',abort,{once:true});image.src=url;
  return image.decode().then(()=>{signal.throwIfAborted();return {width:image.naturalWidth,height:image.naturalHeight};}).finally(()=>{signal.removeEventListener('abort',abort);abort();});
}
/** One active candidate and one latest pending File; obsolete reads cannot queue
 * unlimited decoded candidates or replace the last accepted background. */
export function previewBackground(changed:(url:string)=>void,failed:(message:string)=>void) {
  let generation=0,current='',queued:{file:File;generation:number}|undefined,running=false,active:AbortController|undefined;
  async function drain(){
    if(running)return;running=true;
    try{while(queued){const next=queued;queued=undefined;let url='';
      try{
        const size=await inspectImage(next.file);if(next.generation!==generation)continue;
        active=new AbortController();url=URL.createObjectURL(next.file);
        const decoded=await decode(url,active.signal);if(next.generation!==generation)continue;
        if(!(decoded.width===size.width&&decoded.height===size.height||decoded.width===size.height&&decoded.height===size.width))throw Error('The background dimensions do not match its image header.');
        const previous=current;current=url;url='';changed(current);failed('');if(previous)URL.revokeObjectURL(previous);
      }catch(cause){if(next.generation===generation)failed(cause instanceof Error?cause.message:'The background could not be loaded.');}
      finally{if(url)URL.revokeObjectURL(url);active=undefined;}
    }}finally{running=false;}
  }
  return {
    replace(file?:File){generation++;active?.abort();failed('');queued=file?{file,generation}:undefined;if(!file){if(current)URL.revokeObjectURL(current);current='';changed('');}void drain();},
    destroy(){generation++;queued=undefined;active?.abort();if(current)URL.revokeObjectURL(current);current='';},
  };
}
