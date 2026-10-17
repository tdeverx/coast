import {expect,test} from 'bun:test';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,moduleUrl} from './fixtures/ui-script';
import {mediaDetailTarget} from '../src/lib/media/detail-target';
const source=(await Bun.file(new URL('../src/lib/ui/pages/music.svelte.ts',import.meta.url)).text()).replace(/^import .* from ['"][^'"]+['"];\n/gm,'');
const code=compileRunes(`
 import {musicDuration,musicHero,musicHref} from ${JSON.stringify(import.meta.resolve('../src/lib/music/presentation'))};
 const page={data:{capabilities:{playback:true}}},useClient=()=>({preview:true}),overviewPanels=()=>[];
 const message=error=>error.message,playMusic=async()=>{};
 ${source}
`);
const {createMusicPage}=await import(moduleUrl(code));
const connection='11111111-1111-4111-8111-111111111111',work='22222222-2222-4222-8222-222222222222';
for(const canonical of [true,false])test(`music section links keep ${canonical?'canonical work':'source'} identity`,()=>{
 let view:any;
 const item={id:'a'.repeat(32),workId:canonical?work:undefined,kind:'album',title:'Album',artists:[],albumArtists:[],artistNames:[],genres:[]};
 const dispose=runtime.effect_root(()=>view=createMusicPage(()=>({item,connectionId:connection,children:{items:[]},failure:'',page:1,pages:1}),()=>new URL('https://coast.invalid/for-you'),()=>false));
 try{
  for(const href of [view.rows[0].shelf.source.href,view.model.insights.href]){
   const target=mediaDetailTarget(href,new URL('https://coast.invalid/for-you'));
   expect(target?.kind).toBe(canonical?'work':'music-source');
   expect(target?.id).toBe(canonical?work:item.id);
  }
 }finally{dispose();}
});
