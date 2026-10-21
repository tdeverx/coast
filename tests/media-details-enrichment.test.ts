import {expect,test} from 'bun:test';
const moduleUrl=(source:string)=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const boundaryUrl=moduleUrl(`
export let saved={item:{id:'movie',tmdbId:1},collections:[{id:'collection'}]};
export let pending,fail=false;export const reads=[],refreshes=[],signals=[];
export function reset(){reads.length=0;refreshes.length=0;signals.length=0;fail=false;pending=undefined;}
export async function detailsData(user,id){reads.push([user,id]);return saved;}
export async function requestOptions(user,id,signal){signals.push(signal);return [{id:'destination'}];}
export async function ensureDetails(user,id){refreshes.push([user,id]);if(fail)throw Error('offline');if(pending)await pending;return false;}
export function wait(value){pending=value;}export function offline(){fail=true;}
`);
const source=await Bun.file(new URL('../src/lib/application/media-details.server.ts',import.meta.url)).text();
const code=new Bun.Transpiler({loader:'ts'}).transformSync(source)
 .replaceAll('#lib/server/queries/media.js',boundaryUrl).replaceAll('#lib/providers/seerr/requests.server.js',boundaryUrl).replaceAll('#lib/catalogue/service.server.js',boundaryUrl);
const {loadMediaDetails}=await import(moduleUrl(code));const boundary=await import(boundaryUrl);
test('saved page/overlay details return before provider enrichment and retain request capability',async()=>{
 boundary.reset();let complete!:()=>void;boundary.wait(new Promise<void>(resolve=>complete=resolve));
 const result=await loadMediaDetails('owner','movie');expect(result.item.id).toBe('movie');expect(result.requestable).toBe(false);
 complete();const enriched=await result.enhancement;expect(enriched.requestable).toBe(true);expect(enriched.refreshUnavailable).toBe(false);
 expect(boundary.refreshes).toEqual([['owner','movie'],['owner','collection']]);expect(boundary.reads).toEqual([['owner','movie']]);
});
test('metadata outage preserves saved details and independent request options',async()=>{
 boundary.reset();boundary.offline();const result=await loadMediaDetails('owner','movie');const enriched=await result.enhancement;
 expect(enriched.item.id).toBe('movie');expect(enriched.refreshUnavailable).toBe(true);expect(enriched.requestable).toBe(true);
});
test('page and overlay enhancement forwards its read lifetime to request options',async()=>{
 boundary.reset();const controller=new AbortController();const result=await loadMediaDetails('owner','movie',controller.signal);
 await result.enhancement;expect(boundary.signals).toEqual([controller.signal]);
});
