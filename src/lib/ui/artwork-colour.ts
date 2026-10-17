/** Choose a substantial colourful region, ignoring transparent pixels and black/white margins. */
export function prominentColour(pixels:Uint8ClampedArray):string|null {
 const buckets=new Map<number,{count:number;r:number;g:number;b:number;chroma:number}>();
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
  const weight=bucket.count*.5+bucket.chroma/255;
  if(weight>score){score=weight;selected=bucket;}
 }
 return selected?`rgb(${Math.round(selected.r/selected.count)} ${Math.round(selected.g/selected.count)} ${Math.round(selected.b/selected.count)})`:null;
}

const colours=new Map<string,string|null>();
/** One selected detail artwork, a 32×32 sample and a bounded cache; no catalogue/card fanout. */
export function artworkColour(node:HTMLElement,initial:string[]){
 let source='',dispose=()=>{};
 function update(candidates:string[]){
  const urls=[...new Set(candidates)].slice(0,6),key=JSON.stringify(urls);
  if(key===source)return;
  dispose();source=key;node.style.removeProperty('--artwork-colour');
  let active=true,current:HTMLImageElement|undefined;
  dispose=()=>{active=false;if(current){current.onload=current.onerror=null;current.removeAttribute('src');}};
  function load(index:number){
   if(!active||index>=urls.length)return;
   const url=urls[index];
   if(colours.has(url)){const colour=colours.get(url);if(colour)node.style.setProperty('--artwork-colour',colour);else load(index+1);return;}
   const image=new Image();current=image;
   const finish=(colour:string|null)=>{
    if(!active)return;
    if(colours.size>=64)colours.delete(colours.keys().next().value!);
    colours.set(url,colour);image.onload=image.onerror=null;
    if(colour)node.style.setProperty('--artwork-colour',colour);else load(index+1);
   };
   image.crossOrigin='anonymous';image.referrerPolicy='no-referrer';image.decoding='async';
   image.onload=()=>{
    try{
     const canvas=document.createElement('canvas');canvas.width=canvas.height=32;
     const context=canvas.getContext('2d',{willReadFrequently:true});
     if(!context){finish(null);return;}
     context.drawImage(image,0,0,32,32);const colour=prominentColour(context.getImageData(0,0,32,32).data);
     canvas.width=canvas.height=0;finish(colour);
    }catch{finish(null);}
   };
   image.onerror=()=>finish(null);image.src=url;
  }
  load(0);
 }
 update(initial);
 return {update,destroy(){dispose();node.style.removeProperty('--artwork-colour');}};
}
