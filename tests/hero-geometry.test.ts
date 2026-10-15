import {expect,test} from 'bun:test';
const source=await Bun.file(new URL('../src/lib/ui/heroes/presentation.svelte.ts',import.meta.url)).text();
const handler=source.slice(source.indexOf('  let geometryFrame = 0;'),source.indexOf('  function noteActivity('));
function geometry(){
 const frames=new Map<number,FrameRequestCallback>();let sequence=0,reads=0;
 const rect={top:10,left:20,width:300,height:200},hero={id:'a',visible:true,rect:null as null|typeof rect},document={hidden:false};
 const host={getBoundingClientRect:()=>{reads++;return {...rect};}};
 const create=new Function('heroPlayer','document','requestAnimationFrame','cancelAnimationFrame','element',new Bun.Transpiler({loader:'ts'}).transformSync(`let host=element,active={id:'a'};${handler};return {scheduleGeometry,changeHost:()=>host={},changeId:()=>active={id:'b'},destroy:()=>{cancelAnimationFrame(geometryFrame);geometryFrame=0;host=null;}};`));
 const controls=create(hero,document,(fn:FrameRequestCallback)=>{frames.set(++sequence,fn);return sequence;},(id:number)=>frames.delete(id),host);
 return {controls,hero,document,rect,frames,get reads(){return reads;},flush(){const next=[...frames.values()];frames.clear();next.forEach(fn=>fn(0));}};
}
test('hero scroll/resize bursts read and publish one rectangle per frame, unchanged geometry stays stable',()=>{
 const fixture=geometry();for(let i=0;i<100;i++)fixture.controls.scheduleGeometry();expect(fixture.reads).toBe(0);expect(fixture.frames.size).toBe(1);
 fixture.flush();expect(fixture.reads).toBe(1);expect(fixture.hero.rect).toEqual(fixture.rect);
 const previous=fixture.hero.rect;fixture.controls.scheduleGeometry();fixture.flush();expect(fixture.hero.rect).toBe(previous);
 fixture.rect.top=15;fixture.controls.scheduleGeometry();fixture.flush();expect(fixture.hero.rect?.top).toBe(15);
});
test('hidden, replaced and destroyed hero owners cannot perform late layout work',()=>{
 const fixture=geometry();fixture.hero.visible=false;fixture.controls.scheduleGeometry();expect(fixture.frames.size).toBe(0);
 fixture.hero.visible=true;fixture.document.hidden=true;fixture.controls.scheduleGeometry();expect(fixture.frames.size).toBe(0);
 fixture.document.hidden=false;fixture.controls.scheduleGeometry();fixture.controls.changeHost();fixture.flush();expect(fixture.reads).toBe(0);
 const destroyed=geometry();destroyed.controls.scheduleGeometry();const late=[...destroyed.frames.values()];destroyed.controls.destroy();expect(destroyed.frames.size).toBe(0);late.forEach(fn=>fn(0));expect(destroyed.reads).toBe(0);
});
