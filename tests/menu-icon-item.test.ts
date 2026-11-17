import {expect,test} from 'bun:test';
import {compile} from 'svelte/compiler';
import {render} from 'svelte/server';
import {createRawSnippet} from 'svelte';
import {pathToFileURL} from 'node:url';

const moduleUrl=(source:string)=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const noops=moduleUrl(`export default function Empty(){};
 export const useClient=()=>({preview:false}),liquidGlass=()=>({destroy(){}}),
 createMenuController=()=>null,notifyAction=()=>{},useMenuPreview=()=>undefined;`);
const compiled=compile(await Bun.file('src/lib/ui/components/Button.svelte').text(),{filename:'Button.svelte',generate:'server'});
const code=compiled.js.code.replace(/from (['"])([^'"]+)\1/g,(_all,_quote,specifier)=>{
 const target=specifier==='svelte'||specifier==='svelte/internal/server'
  ?pathToFileURL(Bun.resolveSync(specifier,process.cwd())).href:noops;
 return `from ${JSON.stringify(target)}`;
});
const {default:Button}=await import(moduleUrl(code));
const artwork=createRawSnippet(()=>({render:()=>'<span class="artwork-marker"><svg viewBox="0 0 24 24"></svg></span>'}));

test('icon-only menu items expose artwork directly while retaining accessible toggle semantics',()=>{
 const html=render(Button,{props:{item:true,size:'icon',label:'Add to favourites',checked:false,disabled:true,keepOpen:true,children:artwork}}).body;
 expect(html).toContain('artwork-marker');
 expect(html).not.toContain('menu-action-label');
 expect(html).toContain('role="menuitemcheckbox"');
 expect(html).toContain('aria-label="Add to favourites"');
 expect(html).toContain('aria-checked="false"');
 expect(html).toContain('disabled');
 expect(html).toContain('data-menu-keep-open="true"');
});

test('ordinary menu items retain the shared text-label layout',()=>{
 const html=render(Button,{props:{item:true,text:'Manage',children:artwork}}).body;
 expect(html).toContain('class="menu-action-label"');
 expect(html).toContain('Manage');
 expect(html).toContain('artwork-marker');
 expect(html).toContain('role="menuitem"');
});
