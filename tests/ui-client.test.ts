import { expect, test } from 'bun:test';

// Use the real client contract with local navigation/diagnostic boundaries.
const moduleUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const navigationUrl = moduleUrl('export const invalidations=[]; export async function invalidate(key){invalidations.push(key);}');
const diagnosticsUrl = moduleUrl('export const diagnosticHeaders=()=>({}); export const receiveDiagnosticLevel=()=>{};');
const source = await Bun.file(new URL('../src/lib/ui/client.ts', import.meta.url)).text();
const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(source)
  .replaceAll('$app/navigation', navigationUrl).replaceAll('./diagnostics', diagnosticsUrl);
const { createApiClient, refreshAfterChange }: typeof import('../src/lib/ui/client') = await import(moduleUrl(code));
const { invalidations } = await import(navigationUrl);
const { setRelationship } = await import('../src/lib/ui/relationships');

test('relationship writes use the injected transport and refresh only affected route dependencies', async () => {
  const requests: string[] = [];
  const client = createApiClient(async input => { requests.push(String(input)); return Response.json({}); }, refreshAfterChange);
  invalidations.length = 0;
  await setRelationship('work-id', 'favourite', true, client.change);
  expect(requests).toEqual(['/api/v1/tracking']);
  expect(invalidations).toEqual(['coast:tracking', 'coast:social']);
  invalidations.length = 0;
  await client.change('notifications/id', {});
  expect(invalidations).toEqual(['coast:notifications']);
});

test('a preview rejection never falls through to live delivery or route refresh', async () => {
  let calls = 0, refreshes = 0;
  const client = createApiClient(async () => { calls++; return Response.json({ error: 'Preview only' }, { status: 409 }); }, async () => { refreshes++; });
  await expect(setRelationship('work-id', 'collected', true, client.change)).rejects.toThrow('Preview only');
  expect(calls).toBe(1);
  expect(refreshes).toBe(0);
});
