import {expect,test} from 'bun:test';
import {compile} from 'svelte/compiler';
import {render} from 'svelte/server';
const moduleUrl=(code:string)=>`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const component=async(path:string)=>compile(await Bun.file(path).text(),{filename:path,generate:'server'}).js.code
 .replaceAll('svelte/internal/server',import.meta.resolve('svelte/internal/server'));
const avatar=moduleUrl((await component('src/lib/ui/components/Avatar.svelte'))
 .replaceAll('#lib/social/status.js',import.meta.resolve('../src/lib/social/status.ts')));
const compiled=(await component('src/lib/ui/components/Toast.svelte'))
 .replaceAll('#lib/media/artwork.js',import.meta.resolve('../src/lib/media/artwork.ts'))
 .replaceAll('#lib/profile/url.js',import.meta.resolve('../src/lib/profile/url.ts'))
 .replaceAll('#lib/ui/controls/notification-toasts.js',import.meta.resolve('../src/lib/ui/controls/notification-toasts.ts'))
 .replace(/import \{ liquidGlass \} from ['"].*?['"];?/,"const liquidGlass=()=>{throw Error('Server rendering must not attach glass');};")
 .replace(/import Avatar from ['"].*?['"];?/,`import Avatar from ${JSON.stringify(avatar)};`)
 .replace(/import Icon from ['"].*?['"];?/,"const Icon=()=>{};")
 .replace(/import Button from ['"].*?['"];?/,"const Button=()=>{throw Error('Stamp fixtures do not render action controls');};")
 .replace("import('./MediaCard.svelte')",'new Promise(()=>{})');
const {default:Toast}=await import(moduleUrl(compiled));
const stamp=(html:string,className:string)=>html.match(new RegExp(`<([a-z]+)[^>]*class="${className}[^>]*>`))?.[0]??'';
const base={text:'Shared something',rich:true,stampId:'stable-notice',actor:{username:'A/B & C',avatar:null},media:{id:'external-provider-track',kind:'track',title:'An album track',poster:'/poster.png',href:'/music/work/00000000-0000-4000-8000-000000000074'}};

test('rich stamps expose named native links using actual item routes and encoded profile usernames',()=>{
 const html=render(Toast,{props:base}).body;
 expect(stamp(html,'toast-avatar')).toContain('<a ');expect(stamp(html,'toast-avatar')).toContain('href="/profile/A%2FB%20%26%20C"');
 expect(stamp(html,'toast-avatar')).toContain(`aria-label="View A/B &amp; C's profile"`);expect(stamp(html,'toast-avatar')).not.toContain('aria-hidden');
 expect(html).toMatch(/--avatar-size:\s*44px/);expect(html).toContain('media-surface-edge');
 expect(stamp(html,'toast-artwork')).toContain('<a ');expect(stamp(html,'toast-artwork')).toContain(`href="${base.media.href}"`);
 expect(stamp(html,'toast-artwork')).toContain('aria-label="View An album track"');expect(stamp(html,'toast-artwork')).not.toContain('aria-hidden');
 expect(html).not.toContain('/media/external-provider-track');
});

test('media destinations stay exact across supported media and absent routes remain decorative',()=>{
 for(const [kind,href] of [['movie','/media/movie'],['game','/games/game'],['book','/media/openlibrary/OL123W'],['comic','/media/comic-vine/4000-123'],['album','/music/source/provider-album']] as const){
  const html=render(Toast,{props:{...base,media:{...base.media,kind,href}}}).body;
  expect(stamp(html,'toast-artwork')).toContain(`href="${href}"`);
 }
 const html=render(Toast,{props:{...base,media:{...base.media,href:undefined}}}).body;
 expect(stamp(html,'toast-artwork')).toContain('<div ');expect(stamp(html,'toast-artwork')).toContain('aria-hidden="true"');expect(stamp(html,'toast-artwork')).not.toContain('href=');
 expect(render(Toast,{props:{...base,rich:false}}).body).not.toContain('toast-avatar');
});

test('stamp placement remains stable on revisit and keeps the original corner variation and tilt range',()=>{
 const first=render(Toast,{props:base}).body,again=render(Toast,{props:base}).body;
 for(const name of ['toast-avatar','toast-artwork'])expect(stamp(first,name).match(/style="[^"]*"/)?.[0]).toBe(stamp(again,name).match(/style="[^"]*"/)?.[0]);
 for(const name of ['toast-avatar','toast-artwork']){
  const element=stamp(first,name),angle=Number(element.match(/--stamp-tilt: (-?\d+)deg/)?.[1]);
  expect(Math.abs(angle)).toBeGreaterThanOrEqual(4);expect(Math.abs(angle)).toBeLessThanOrEqual(7);
  for(const axis of ['x','y'])expect(Math.abs(Number(element.match(new RegExp(`--stamp-${axis}: (-?\\d+)px`))?.[1]))).toBeLessThanOrEqual(2);
 }
 const next=render(Toast,{props:{...base,stampId:'another-notice'}}).body;
 expect(['toast-avatar','toast-artwork'].some(name=>stamp(first,name).match(/style="[^"]*"/)?.[0]!==stamp(next,name).match(/style="[^"]*"/)?.[0])).toBe(true);
});
