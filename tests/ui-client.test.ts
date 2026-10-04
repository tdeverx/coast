import { expect, test } from 'bun:test';
import { compileModule } from 'svelte/compiler';

// Use the real client contract with local navigation/diagnostic boundaries.
const moduleUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const navigationUrl = moduleUrl('export const invalidations=[]; export let refreshes=0; export async function invalidate(key){invalidations.push(key);} export async function refreshAll(){refreshes++;}');
const stateUrl=moduleUrl('export const page={state:{}};');
const diagnosticsUrl = moduleUrl('export const diagnosticHeaders=()=>({}); export const receiveDiagnosticLevel=()=>{};');
const revisionSource = await Bun.file(new URL('../src/lib/ui/content-revision.svelte.ts', import.meta.url)).text();
const revisionCode = compileModule(new Bun.Transpiler({ loader: 'ts' }).transformSync(revisionSource), { filename: 'content-revision.svelte.js', generate: 'client' }).js.code
  .replaceAll('svelte/internal/client', import.meta.resolve('svelte/internal/client'));
const revisionUrl = moduleUrl(revisionCode);
const { readContentRevision }: typeof import('../src/lib/ui/content-revision.svelte') = await import(revisionUrl);
const source = await Bun.file(new URL('../src/lib/ui/client.ts', import.meta.url)).text();
const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(source)
  .replaceAll('$app/state',stateUrl).replaceAll('$app/navigation', navigationUrl).replaceAll('./diagnostics', diagnosticsUrl).replaceAll('./content-revision.svelte', revisionUrl);
const { createApiClient, refreshAfterChange, refreshRouteDependencies }: typeof import('../src/lib/ui/client') = await import(moduleUrl(code));
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
  for(const state of [{mediaModalId:'work'},{friendsPopover:true},{notificationPopover:true}]){
    page.state=state;await refreshRouteDependencies(['session']);
  }
  expect(navigation.refreshes).toBe(before+3);expect(invalidations).toEqual([]);
  page.state={};await refreshRouteDependencies(['tracking']);
  expect(invalidations).toEqual(['coast:tracking']);
  await refreshRouteDependencies([]);expect(navigation.refreshes).toBe(before+3);
});
