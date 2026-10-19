import {expect,test} from 'bun:test';
import {liquidGlass,type LiquidGlassOptions} from '../src/lib/ui/materials/glass';
import {glassPresets,type GlassSurface} from '../src/lib/ui/materials/presets';

class Style {
  values = new Map<string,string>();
  setProperty(key:string,value:string){this.values.set(key,value);}
  getPropertyValue(key:string){return this.values.get(key)??'';}
  removeProperty(key:string){this.values.delete(key);}
}
class Element {
  parent:Element|null=null;
  children:Element[]=[];
  style=new Style();
  dataset:Record<string,string>={};
  attributes=new Map<string,string>();
  classes=new Set<string>();
  classList={add:(value:string)=>{this.classes.add(value);},remove:(value:string)=>{this.classes.delete(value);}};
  offsetWidth=32;offsetHeight=20;id='';className='';
  constructor(readonly tag:string,private root=false){}
  get isConnected():boolean{return this.root||!!this.parent?.isConnected;}
  setAttribute(key:string,value:string){this.attributes.set(key,value);}
  append(...nodes:Element[]){for(const node of nodes){node.remove();node.parent=this;this.children.push(node);}}
  prepend(node:Element){node.remove();node.parent=this;this.children.unshift(node);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}
}

/** Actual action/map code, controlled DOM/canvas/scheduler boundaries. These are not
 * browser paint, pixel-quality, actual-data or CPU/GPU performance measurements. */
function runtime(blink=true){
  const names=['document','navigator','CSS','matchMedia','MutationObserver','ResizeObserver','requestAnimationFrame','cancelAnimationFrame','getComputedStyle','setTimeout'] as const;
  const previous=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const body=new Element('body',true),root=new Element('root',true),frames=new Map<number,FrameRequestCallback>(),timers=new Map<number,()=>void>();
  const mutations:{callback:()=>void;disconnected:boolean}[]=[],resizes:{callback:()=>void;disconnected:boolean}[]=[],mediaListeners=new Set<()=>void>();
  const actions:ReturnType<typeof liquidGlass>[]=[];
  let sequence=0,enabled=true,radius='4px',maps=0;
  const preference={matches:false,addEventListener:(_name:string,fn:()=>void)=>mediaListeners.add(fn),removeEventListener:(_name:string,fn:()=>void)=>mediaListeners.delete(fn)};
  const globals={
    document:{body,querySelector:(selector:string)=>selector==='[data-coast-glass]'||enabled?root:null,createElement:(tag:string)=>{
      const node=new Element(tag);
      if(tag==='canvas')Object.assign(node,{width:0,height:0,getContext:()=>({createImageData:(width:number,height:number)=>({data:new Uint8ClampedArray(width*height*4)}),putImageData(){}}),toDataURL:()=>{maps++;return 'data:image/png;controlled-map-'+maps;}});
      return node;
    },createElementNS:(_namespace:string,tag:string)=>new Element(tag)},
    navigator:{userAgent:blink?'Chrome/130.0':'Version/18.0 Safari/605.1.15'},CSS:{supports:()=>true},matchMedia:()=>preference,
    MutationObserver:class{entry:{callback:()=>void;disconnected:boolean};constructor(callback:()=>void){this.entry={callback,disconnected:false};mutations.push(this.entry);}observe(){}disconnect(){this.entry.disconnected=true;}},
    ResizeObserver:class{entry:{callback:()=>void;disconnected:boolean};constructor(callback:()=>void){this.entry={callback,disconnected:false};resizes.push(this.entry);}observe(){}disconnect(){this.entry.disconnected=true;}},
    requestAnimationFrame:(callback:FrameRequestCallback)=>{frames.set(++sequence,callback);return sequence;},cancelAnimationFrame:(id:number)=>{frames.delete(id);},
    getComputedStyle:()=>({borderTopLeftRadius:radius}),setTimeout:(callback:()=>void)=>{timers.set(++sequence,callback);return sequence;},
  };
  for(const [name,value] of Object.entries(globals))Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  const flush=()=>{const current=[...frames];frames.clear();for(const [,callback]of current)callback(0);};
  const destroy=()=>{for(const action of actions)action.destroy();actions.length=0;flush();for(const callback of timers.values())callback();timers.clear();flush();};
  return {body,frames,timers,mutations,resizes,mediaListeners,preference,flush,get maps(){return maps;},
    setRadius(value:string){radius=value;},setting(value:boolean){enabled=value;mutations.filter(entry=>!entry.disconnected).forEach(entry=>entry.callback());},
    appearance(value:boolean){preference.matches=value;mediaListeners.forEach(callback=>callback());},resize(){resizes.filter(entry=>!entry.disconnected).forEach(entry=>entry.callback());},
    mount(options:LiquidGlassOptions|boolean=true){const node=new Element('surface');body.append(node);const action=liquidGlass(node as unknown as HTMLElement,options);actions.push(action);return {node,action,definition:()=>{const id=node.style.getPropertyValue('backdrop-filter').match(/url\("#([^"]+)"\)/u)?.[1];return body.children.find(child=>child.tag==='svg'&&child.children[0]?.id===id)!;}};},
    destroy,restore(){destroy();for(const name of names){const descriptor=previous.get(name);if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}},
  };
}

test('unchanged effective native updates retain SVG identity and the existing displacement map',()=>{
  const env=runtime();try{
    const current=env.mount(),definition=current.definition(),mapCount=env.maps;
    current.action.update({});env.resize();env.resize();expect(env.frames.size).toBe(1);env.flush();
    expect(current.definition()).toBe(definition);expect(env.maps).toBe(mapCount);expect(definition.isConnected).toBe(true);
    expect(current.node.dataset.coastGlassRenderer).toBe('original-svg-backdrop');expect(current.node.classes.has('liquid-glass-active')).toBe(true);
    definition.remove();current.action.update({});env.flush();expect(current.definition()).not.toBe(definition);expect(env.maps).toBe(mapCount);
  }finally{env.restore();}
});

test('native inputs remain live and zero-size surfaces release and rebuild native resources',()=>{
  const env=runtime();try{
    const base={depth:4,refraction:0.5,dispersion:1,blur:2},current=env.mount({surface:base});
    const change=(run:()=>void)=>{const before=current.definition();run();env.flush();expect(current.definition()).not.toBe(before);expect(before.isConnected).toBe(false);};
    change(()=>{current.node.offsetWidth++;env.resize();});change(()=>{current.node.offsetHeight++;env.resize();});change(()=>{env.setRadius('3px');env.resize();});
    for(const surface of [{...base,depth:5},{...base,refraction:0.75},{...base,dispersion:2},{...base,blur:3}])change(()=>current.action.update({surface}));
    const last=current.definition(),maps=env.maps;current.node.offsetWidth=0;env.resize();env.flush();
    expect(last.isConnected).toBe(false);expect(current.definition()).toBeUndefined();expect(env.maps).toBe(maps);
    expect(current.node.dataset.coastGlassRenderer).toBe('hidden');expect(current.node.classes.has('liquid-glass-active')).toBe(false);
    env.resize();env.flush();expect(current.definition()).toBeUndefined();expect(env.maps).toBe(maps);
    current.node.offsetWidth=33;env.resize();env.flush();expect(current.definition()).not.toBe(last);expect(env.maps).toBe(maps+1);
    expect(current.node.dataset.coastGlassRenderer).toBe('original-svg-backdrop');
    const reopened=current.definition();current.node.offsetHeight=0;env.resize();env.flush();expect(reopened.isConnected).toBe(false);
    current.action.update({surface:{...base,depth:6}});env.flush();expect(env.maps).toBe(maps+1);
    current.node.offsetHeight=21;env.resize();env.flush();expect(current.definition()).toBeDefined();expect(env.maps).toBe(maps+2);
  }finally{env.restore();}
});

test('all non-SVG surface inputs update styles and grain without replacing the native definition',()=>{
  const env=runtime();try{
    const surface:GlassSurface={...glassPresets.materials.clear,noiseOpacity:5,noiseCoverage:'edges'},current=env.mount({surface}),definition=current.definition();
    const snapshot=()=>JSON.stringify({style:[...current.node.style.values],grain:current.node.children.map(child=>child.style),variant:current.node.dataset.coastGlassVariant});
    const alternate:Record<string,string>={strokeAlignment:'internal',strokeBlend:'multiply',shadowPosition:'inner',noiseBlend:'multiply',noiseTintBlend:'screen',noiseCoverage:'uniform'};
    for(const key of Object.keys(surface)as(keyof GlassSurface)[]){
      if(['depth','refraction','dispersion','blur'].includes(key))continue;
      current.action.update({surface});env.flush();const before=snapshot(),value=surface[key];
      const next={...surface,[key]:typeof value==='number'?value+1:alternate[key]??'#123456'};
      current.action.update({surface:next});env.flush();expect(snapshot()).not.toBe(before);expect(current.definition()).toBe(definition);
    }
    current.action.update({variant:'glassProminent',surface});env.flush();expect(current.definition()).toBe(definition);expect(current.node.dataset.coastGlassVariant).toBe('glassProminent');
    expect(current.node.style.getPropertyValue('--coast-glass-solid-fill')).toBe('var(--accent)');
  }finally{env.restore();}
});

test('native gate transitions, shared observers and deferred teardown preserve ownership',()=>{
  const env=runtime();try{
    const one=env.mount(),two=env.mount(),first=one.definition();expect(env.mediaListeners.size).toBe(1);expect(env.mutations).toHaveLength(1);
    env.setting(false);env.flush();expect(first.isConnected).toBe(false);expect(one.node.dataset.coastGlassRenderer).toBe('disabled');expect(env.body.children.filter(node=>node.tag==='svg')).toHaveLength(0);
    env.setting(true);env.flush();expect(one.definition()).not.toBe(first);expect(env.body.children.filter(node=>node.tag==='svg')).toHaveLength(2);
    env.appearance(true);env.flush();expect(env.body.children.filter(node=>node.tag==='svg')).toHaveLength(0);env.appearance(false);env.flush();
    one.action.update({renderer:'css'});env.flush();expect(one.node.dataset.coastGlassRenderer).toBe('css');
    one.action.update({enabled:false});env.flush();expect(one.node.dataset.coastGlassRenderer).toBe('disabled');
    one.action.update({surface:{refraction:0}});env.flush();expect(one.node.dataset.coastGlassRenderer).toBe('css');
    one.action.update({});env.flush();expect(one.node.dataset.coastGlassRenderer).toBe('original-svg-backdrop');
    env.resize();const stale=two.definition();env.destroy();expect(env.mediaListeners.size).toBe(0);expect(env.mutations.every(entry=>entry.disconnected)).toBe(true);expect(env.resizes.every(entry=>entry.disconnected)).toBe(true);
    expect(env.frames.size).toBe(0);expect(stale.isConnected).toBe(false);expect(one.node.style.values.size).toBe(0);expect(one.node.dataset).toEqual({});
  }finally{env.restore();}
  const unsupported=runtime(false);try{const current=unsupported.mount();expect(unsupported.maps).toBe(0);expect(current.node.dataset.coastGlassRenderer).toBe('css');expect(current.definition()).toBeUndefined();}finally{unsupported.restore();}
});

/** Exercise Button's existing action wrapper and actual template binding against
 * the real glass owner. DOM/canvas/media/scheduler boundaries are controlled;
 * this does not establish browser paint, native decoding or actual UI timing. */
test('closed menu surfaces release material owners and reopening survives stale SVG cleanup',async()=>{
  const source=await Bun.file(new URL('../src/lib/ui/components/Button.svelte',import.meta.url)).text();
  const start=source.indexOf('  function surfaceMaterial('),end=source.indexOf('  function activate(',start);
  const binding=source.match(/<div bind:this=\{surface\}[\s\S]*?use:surfaceMaterial=\{(\{[^}]+\})\}/)?.[1];
  if(start<0||end<start||!binding)throw Error('Review Button menu material ownership before updating its lifecycle contract.');
  const make=new Function('liquidGlass',new Bun.Transpiler({loader:'ts'}).transformSync(source.slice(start,end))+';return surfaceMaterial;')(liquidGlass);
  const options=new Function('controller',`return (${binding});`);
  for(const blink of [true,false]){
    const env=runtime(blink),controller={open:false},node=new Element('menu');env.body.append(node);
    const material=make(node,options(controller));
    const observers=()=>env.resizes.filter(entry=>!entry.disconnected).length;
    const settings=()=>env.mutations.filter(entry=>!entry.disconnected).length;
    try{
      expect(observers()).toBe(0);expect(settings()).toBe(0);expect(env.mediaListeners.size).toBe(0);
      controller.open=true;material.update(options(controller));
      expect(observers()).toBe(1);expect(settings()).toBe(1);expect(env.mediaListeners.size).toBe(1);
      expect(node.dataset.coastGlassRenderer).toBe(blink?'original-svg-backdrop':'css');
      const first=env.body.children.find(child=>child.tag==='svg'),maps=env.maps;
      material.update(options(controller));expect(observers()).toBe(1);expect(env.maps).toBe(maps);
      // A queued old resize must not run after close; the wrapper retains the
      // menu/controller itself and destroys only its owned material action.
      env.resize();controller.open=false;material.update(options(controller));env.flush();
      expect(observers()).toBe(0);expect(settings()).toBe(0);expect(env.mediaListeners.size).toBe(0);expect(node.style.values.size).toBe(0);
      env.setting(false);controller.open=true;material.update(options(controller));
      expect(observers()).toBe(1);expect(node.dataset.coastGlassRenderer).toBe(blink?'disabled':'css');
      env.setting(true);env.flush();
      expect(node.dataset.coastGlassRenderer).toBe(blink?'original-svg-backdrop':'css');
      const current=env.body.children.filter(child=>child.tag==='svg').at(-1);
      if(blink){expect(current).not.toBe(first);expect(first?.isConnected).toBe(true);}
      // Existing delayed removal belongs to the previous SVG, so a rapid
      // reopen must retain its newly owned filter and current material styles.
      for(const callback of env.timers.values())callback();env.timers.clear();env.flush();
      if(blink){expect(first?.isConnected).toBe(false);expect(current?.isConnected).toBe(true);}
      expect(env.body.children.filter(child=>child.tag==='svg')).toHaveLength(blink?1:0);
      controller.open=false;material.update(options(controller));material.update(options(controller));env.flush();
      expect(observers()).toBe(0);expect(settings()).toBe(0);expect(env.mediaListeners.size).toBe(0);expect(node.children).toHaveLength(0);
      for(const callback of env.timers.values())callback();env.timers.clear();env.flush();
      expect(env.body.children.filter(child=>child.tag==='svg')).toHaveLength(0);expect(env.frames.size).toBe(0);
    }finally{material.destroy();env.restore();}
  }
});
