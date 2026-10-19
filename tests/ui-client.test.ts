import { expect, test, spyOn } from 'bun:test';
import { compileModule } from 'svelte/compiler';

// Use the real client contract with local navigation/diagnostic boundaries.
const moduleUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const navigationUrl = moduleUrl('export const invalidations=[]; export let refreshes=0,fullInvalidations=0; export async function invalidate(key){invalidations.push(key);} export async function invalidateAll(){fullInvalidations++;} export async function refreshAll(){refreshes++;}');
const stateUrl=moduleUrl('export const page={state:{}};');
const diagnosticsUrl = moduleUrl('export const received={count:0}; export const diagnosticHeaders=()=>({}); export const receiveDiagnosticLevel=()=>{received.count++;};');
const revisionSource = await Bun.file(new URL('../src/lib/ui/content-revision.svelte.ts', import.meta.url)).text();
const revisionCode = compileModule(new Bun.Transpiler({ loader: 'ts' }).transformSync(revisionSource), { filename: 'content-revision.svelte.js', generate: 'client' }).js.code
  .replaceAll('svelte/internal/client', import.meta.resolve('svelte/internal/client'));
const revisionUrl = moduleUrl(revisionCode);
const { readContentRevision }: typeof import('../src/lib/ui/content-revision.svelte') = await import(revisionUrl);
const feedbackUrl = moduleUrl('export const notices=[]; export function notifyAction(text){notices.push(text);}');
const source = await Bun.file(new URL('../src/lib/ui/client.ts', import.meta.url)).text();
const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(source)
  .replaceAll('./action-feedback.svelte', feedbackUrl).replaceAll('$app/state',stateUrl).replaceAll('$app/navigation', navigationUrl).replaceAll('./diagnostics', diagnosticsUrl).replaceAll('./content-revision.svelte', revisionUrl);
const { createApiClient, refreshAfterChange, refreshRouteDependencies, capturePlaybackApi, setPlaybackApi }: typeof import('../src/lib/ui/client') = await import(moduleUrl(code));
const { invalidations } = await import(navigationUrl);
const { setRelationship } = await import('../src/lib/ui/relationships');

test('relationship writes use the injected transport and refresh only affected route dependencies', async () => {
  const requests: string[] = [];
  const client = createApiClient(async input => { requests.push(String(input)); return Response.json({}); }, refreshAfterChange);
  const tracking = readContentRevision('tracking'), social = readContentRevision('social');
  invalidations.length = 0;
  await setRelationship('work-id', 'favourite', true, client.change);
  expect(requests).toEqual(['/api/v1/tracking']);
  expect(invalidations).toEqual(['coast:tracking', 'coast:social']);
  expect(readContentRevision('tracking')).toBe(tracking + 1);
  expect(readContentRevision('social')).toBe(social + 1);
  invalidations.length = 0;
  await client.change('notifications/id', {});
  expect(invalidations).toEqual(['coast:notifications']);
  expect(readContentRevision('tracking')).toBe(tracking + 1);
  expect(readContentRevision('social')).toBe(social + 1);
});

test('a preview rejection never falls through to live delivery or route refresh', async () => {
  let calls = 0, refreshes = 0;
  const client = createApiClient(async () => { calls++; return Response.json({ error: 'Preview only' }, { status: 409 }); }, async () => { refreshes++; });
  await expect(setRelationship('work-id', 'collected', true, client.change)).rejects.toThrow('Preview only');
  expect(calls).toBe(1);
  expect(refreshes).toBe(0);
});

test('open shallow overlays use a state-preserving refresh while ordinary pages remain scoped', async()=>{
  const {page}=await import(stateUrl),navigation=await import(navigationUrl);
  const before=navigation.refreshes;invalidations.length=0;
  for(const state of [{mediaDetailHref:'work'},{friendsPopover:true},{notificationPopover:true},{streamsPopover:true}]){
    page.state=state;await refreshRouteDependencies(['session']);await refreshRouteDependencies('all');
  }
  expect(navigation.refreshes).toBe(before+8);expect(invalidations).toEqual([]);expect(navigation.fullInvalidations).toBe(0);
  page.state={};await refreshRouteDependencies(['tracking']);
  expect(invalidations).toEqual(['coast:tracking']);
  await refreshRouteDependencies('all');expect(navigation.fullInvalidations).toBe(1);
  page.state={friendsPopover:true};await refreshRouteDependencies([]);expect(navigation.refreshes).toBe(before+8);
  page.state={};
});


test('captured playback authority survives share-route teardown for preparation and cleanup',async()=>{
 const urls:string[]=[];const transport=spyOn(globalThis,'fetch').mockImplementation(Object.assign(async(input:Parameters<typeof fetch>[0])=>{urls.push(String(input));return Response.json({});},{preconnect:()=>{}}));
 try{
  setPlaybackApi(true);const request=capturePlaybackApi();setPlaybackApi(false);
  await request('playback',{});await request('playback/prepared/progress',{event:'stop'});
  expect(urls).toEqual(['/api/share/playback','/api/share/playback/prepared/progress']);
 }finally{transport.mockRestore();setPlaybackApi(false);}
});
test('an older share authority release cannot reset a reopened owner',async()=>{
 const urls:string[]=[];const transport=spyOn(globalThis,'fetch').mockImplementation(Object.assign(async(input:Parameters<typeof fetch>[0])=>{urls.push(String(input));return Response.json({});},{preconnect:()=>{}}));
 try{
  const releaseOld=setPlaybackApi(true),releaseCurrent=setPlaybackApi(true);
  releaseOld();await capturePlaybackApi()('playback',{});
  releaseCurrent();await capturePlaybackApi()('playback',{});
  expect(urls).toEqual(['/api/share/playback','/api/v1/playback']);
 }finally{transport.mockRestore();setPlaybackApi(false);}
});


test('successful transport acknowledgement survives failed route refresh', async () => {
  let writes = 0;
  const client = createApiClient(async () => { writes++; return Response.json({ id: 'accepted' }); }, async () => { throw new Error('Route unavailable'); });
  expect(await client.change<{ id: string }>('reading/id/progress', {})).toEqual({ id: 'accepted' });
  expect(writes).toBe(1);
  expect((await import(feedbackUrl)).notices.at(-1)).toContain('Saved.');
});

test('cancelled optional requests cannot publish a late expiry after transport or body completion', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const expired: string[] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent(event: Event) { expired.push(event.type); return true; } } });
  const {received} = await import(diagnosticsUrl);
  try {
    for (const phase of ['transport', 'body'] as const) {
      const controller = new AbortController();
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>(resolve => entered = resolve), held = new Promise<void>(resolve => release = resolve);
      const before = received.count;
      const client = createApiClient(async () => {
        const response = Response.json({error:'Expired session'}, {status:401});
        if (phase === 'transport') { entered(); await held; }
        else Object.defineProperty(response, 'json', {value: async () => { entered(); await held; throw controller.signal.reason; }});
        return response;
      }, async () => {});
      const pending = client.api('notifications', undefined, 'GET', {signal:controller.signal});
      void pending.catch(() => {});
      await started;
      controller.abort(); release();
      await expect(pending).rejects.toMatchObject({name:'AbortError'});
      expect(expired).toEqual([]);
      expect(received.count-before).toBe(phase === 'transport' ? 0 : 1);
    }
    const abortedBody = createApiClient(async () => {
      const response = Response.json({}, {status:401});
      Object.defineProperty(response, 'json', {value:async () => { throw new DOMException('Body cancelled', 'AbortError'); }});
      return response;
    }, async () => {});
    await expect(abortedBody.api('notifications',undefined,'GET')).rejects.toMatchObject({name:'AbortError'});
    expect(expired).toEqual([]);
    const live = createApiClient(async () => Response.json({error:'Expired session'}, {status:401}), async () => {});
    await expect(live.api('notifications', undefined, 'GET')).rejects.toMatchObject({status:401});
    expect(expired).toEqual(['coast:auth-expired']);
    const release = setPlaybackApi(true);
    try { await expect(live.api('playback',undefined,'GET')).rejects.toMatchObject({status:401}); }
    finally { release(); }
    expect(expired).toEqual(['coast:auth-expired']);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('already-cancelled optional requests admit no transport', async () => {
  let calls = 0;
  const client = createApiClient(async () => { calls++; return Response.json({}); }, async () => {});
  const controller = new AbortController(); controller.abort();
  await expect(client.api('notifications',undefined,'GET',{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
  expect(calls).toBe(0);
});

test('an invalid success body cannot acknowledge a write or start its refresh', async () => {
  let refreshes = 0;
  const client = createApiClient(async () => new Response('<html>Unavailable</html>'), async () => { refreshes++; });
  await expect(client.change('notifications/id', {})).rejects.toMatchObject({status:502, message:'The server returned an invalid response. Please try again.'});
  expect(refreshes).toBe(0);
  const valid = createApiClient(async () => Response.json(null), async () => {});
  expect(await valid.api('optional',undefined,'GET')).toBeNull();
});

test('invalid or null error bodies retain the HTTP failure instead of throwing a payload TypeError', async () => {
  for (const response of [new Response('<html>Unavailable</html>',{status:503}),Response.json(null,{status:403})]) {
    const client = createApiClient(async () => response,async () => {});
    await expect(client.api('notifications',undefined,'GET')).rejects.toMatchObject({status:response.status});
  }
});

test('grouped commands retain acknowledgement order and refresh once at logical completion',async()=>{
 const trace:string[]=[];
 const client=createApiClient(async input=>{trace.push(String(input));return Response.json({accepted:trace.length});},async path=>{trace.push('refresh:'+path);});
 expect(await client.changeMany(['social/first','social/second'],{action:'save'})).toEqual([{accepted:1},{accepted:2}]);
 expect(trace).toEqual(['/api/v1/social/first','/api/v1/social/second','refresh:social/first']);
});
test('grouped partial failure refreshes the acknowledged prefix and never retries or delivers its suffix',async()=>{
 for(const failAt of [0,1]){
  const writes:string[]=[],refreshes:string[]=[];
  const client=createApiClient(async input=>{writes.push(String(input));return writes.length===failAt+1?Response.json({error:'Declined'},{status:409}):Response.json({accepted:true});},async path=>{refreshes.push(path);});
  await expect(client.changeMany(['social/first','social/second','social/third'],{})).rejects.toMatchObject({status:409});
  expect(writes).toEqual(['/api/v1/social/first','/api/v1/social/second'].slice(0,failAt+1));
  expect(refreshes).toEqual(failAt?['social/first']:[]);
 }
});
test('empty or mixed-domain groups admit no commands and failed refresh preserves every acknowledgement',async()=>{
 let writes=0;
 const client=createApiClient(async()=>{writes++;return Response.json({accepted:true});},async()=>{throw Error('Refresh unavailable');});
 expect(await client.changeMany([])).toEqual([]);
 await expect(client.changeMany(['social/first','tracking/second'])).rejects.toThrow('one command domain');expect(writes).toBe(0);
 expect(await client.changeMany(['social/first','social/second'])).toEqual([{accepted:true},{accepted:true}]);expect(writes).toBe(2);
});
