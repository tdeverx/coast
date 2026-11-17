import {expect,test} from 'bun:test';
import {compile} from 'svelte/compiler';
import {render} from 'svelte/server';
const moduleUrl=(code:string)=>`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
async function serverComponent(path:string){
 return compile(await Bun.file(new URL(`../${path}`,import.meta.url)).text(),{filename:path,generate:'server'}).js.code
  .replaceAll('svelte/internal/server',import.meta.resolve('svelte/internal/server'));
}
const toast=moduleUrl((await serverComponent('src/lib/ui/components/Toast.svelte'))
 .replace(/from (['"])#lib\/ui\/controls\/notification-toasts\.js\1/,`from ${JSON.stringify(import.meta.resolve('../src/lib/ui/controls/notification-toasts'))}`)
 .replace(/import \{ cardArtwork \} from ['"].*?['"];?/,"const cardArtwork=()=>({candidates:[]});")
 .replace(/import \{ liquidGlass \} from ['"].*?['"];?/,"const liquidGlass=()=>{};")
 .replace(/import (Avatar|MediaCard) from ['"].*?['"];?/g,"const $1=()=>{};")
 .replace(/import Icon from ['"].*?['"];?/,"const Icon=()=>{};")
 .replace(/import Button from ['"].*?['"];?/,"const Button=()=>{throw Error('Server fallback must not depend on interactive controls');};"));
// SSR must never invoke browser route refresh, persistence or interactive UI.
const client=moduleUrl("export function refreshAfterChange(){throw Error('Server feedback must not refresh routes');}");
const host=await serverComponent('src/lib/ui/components/NotificationToasts.svelte');
const {default:NotificationToasts}=await import(moduleUrl(host
 .replace(/import \{ temporaryFeedback \} from ['"].*?['"];?/,"const temporaryFeedback=()=>false;")
 .replace(/import \{ openNotifications \} from ['"].*?['"];?/,"const openNotifications=()=>{};")
 .replace(/import \{ useClient \} from ['"].*?['"];?/,"const useClient=()=>({preview:false,api:()=>{throw Error('Server feedback must not persist notifications');},feedback:{activeHost:null,current:null}});")
 .replace(/from (['"])#lib\/ui\/client\.js\1/,`from ${JSON.stringify(client)}`)
 .replace(/from (['"])#lib\/ui\/controls\/notification-toasts\.js\1/,`from ${JSON.stringify(import.meta.resolve('../src/lib/ui/controls/notification-toasts'))}`)
 .replace(/import Toast from ['"].*?['"];?/,`import Toast from ${JSON.stringify(toast)};`)));
test('native form failures render the existing toast before hydration without requiring JavaScript',()=>{
 const html=render(NotificationToasts,{props:{notifications:[],initialFailure:'Check your username and password.'}}).body;
 expect(html).toContain('class="toasts');expect(html).toContain('solid-surface');expect(html).toContain('role="alert"');
 expect(html).toContain('Check your username and password.');expect(html).not.toContain('<button');
});
test('server auth feedback escapes errors and normal initial pages have no empty toast',()=>{
 const html=render(NotificationToasts,{props:{notifications:[],initialFailure:'<script>invalid</script>'}}).body;
 expect(html).not.toContain('<script>invalid');expect(html).toContain('&lt;script>invalid&lt;/script>');
 expect(render(NotificationToasts,{props:{notifications:[]}}).body).not.toContain('role="alert"');
});
