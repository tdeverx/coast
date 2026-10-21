import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { checkBunAdapter } from '../scripts/check-bun-adapter';

const root = resolve(import.meta.dir, '..');

// Exercise the installed adapter, replacing only Kit's generated server/assets handoff.
const built = await Bun.build({
  entrypoints: ['coast-origin-probe'],
  target: 'bun',
  plugins: [{ name: 'origin-probe', setup(build) {
    build.onResolve({ filter: /^coast-origin-probe$/ }, () => ({ path: 'entry', namespace: 'probe' }));
    build.onResolve({ filter: /^#@sveltejs\/adapter-bun$/ }, () => ({ path: 'handoff', namespace: 'probe' }));
    build.onResolve({ filter: /^\.\/routes\.js$/ }, args => args.importer.endsWith('/adapter-bun/src/handler.js')
      ? { path: 'assets', namespace: 'probe' } : undefined);
    build.onLoad({ filter: /.*/, namespace: 'probe' }, args => ({ loader: 'js', contents:
      args.path === 'assets' ? 'export const server_assets = new Map();' :
      args.path === 'handoff' ? `
        import { assertSameOrigin } from ${JSON.stringify(resolve(root, 'src/lib/server/security/csrf.ts'))};
        import { setSessionCookie } from ${JSON.stringify(resolve(root, 'src/lib/server/auth/cookies.ts'))};
        export const env_prefix = process.env.COAST_PROBE_PREFIX || '';
        export const origin = process.env.COAST_PROBE_BUILD_ORIGIN;
        export const server = { init: async () => {}, respond: async request => {
          try { assertSameOrigin(request); } catch { return new Response(null, {status:403}); }
          let secure;
          setSessionCookie({set: (_name, _token, options) => {secure = options.secure;}}, 'probe', new Date(), new URL(request.url));
          return Response.json({url:request.url, secure});
        }};
      ` : `
        import { handler } from ${JSON.stringify(resolve(root, 'node_modules/@sveltejs/adapter-bun/src/handler.js'))};
        const headers = JSON.parse(process.env.COAST_PROBE_HEADERS || '{}');
        const response = await handler(new Request('http://internal:3000/api/example?keep=yes', {
          method:process.env.COAST_PROBE_METHOD || 'GET', headers
        }), {});
        console.log(JSON.stringify({status:response.status, body:await response.text()}));
      ` }));
  } }],
});
if (!built.success) throw new AggregateError(built.logs, 'Adapter origin probe failed to bundle');
const bundle = await built.outputs[0].text();

async function probe(settings: Record<string, string>) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !['ORIGIN', 'PROTOCOL_HEADER', 'HOST_HEADER', 'PORT_HEADER', 'ADDRESS_HEADER', 'XFF_DEPTH'].includes(key) &&
    !key.startsWith('COAST_PROBE_') && !key.startsWith('PROBE_')));
  const child = Bun.spawn([process.execPath, '--eval', bundle], { env: { ...env, ...settings }, stdout:'pipe', stderr:'pipe' });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, stderr, result: code === 0 ? JSON.parse(stdout.trim()) : undefined };
}

test('runtime ORIGIN preserves LAN HTTP and public HTTPS, path/query and session cookie policy', async () => {
  for (const origin of ['http://192.168.0.18:3000', 'https://coast.example', 'http://localhost:3000/']) {
    const canonical = new URL(origin).origin;
    const {code, result} = await probe({ ORIGIN: origin, COAST_PROBE_METHOD:'POST', COAST_PROBE_HEADERS:JSON.stringify({origin:canonical, host:'spoof.example', 'x-forwarded-proto':'https'}) });
    expect(code).toBe(0);
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({url:`${canonical}/api/example?keep=yes`, secure:canonical.startsWith('https:')});
  }
});

test('runtime origin rejects cross-origin mutations and overrides build-time origin', async () => {
  const {result} = await probe({ ORIGIN:'https://coast.example', COAST_PROBE_BUILD_ORIGIN:'http://build.example', COAST_PROBE_METHOD:'POST', COAST_PROBE_HEADERS:'{"origin":"https://other.example"}' });
  expect(result.status).toBe(403);
});

test('origin honors adapter envPrefix and retains native fallback when unset', async () => {
  const prefixed = await probe({ COAST_PROBE_PREFIX:'PROBE_', PROBE_ORIGIN:'http://192.168.0.18:3000', ORIGIN:'https://ignored.example' });
  expect(JSON.parse(prefixed.result.body).url).toBe('http://192.168.0.18:3000/api/example?keep=yes');
  const fallback = await probe({ COAST_PROBE_HEADERS:'{"host":"coast.example"}' });
  expect(JSON.parse(fallback.result.body).url).toBe('https://coast.example/api/example?keep=yes');
});

test('invalid configured origins fail startup instead of serving with a wrong origin', async () => {
  for (const origin of ['not-a-url', 'file:///tmp/coast', 'https://user:password@coast.example', 'https://coast.example/path', 'https://coast.example?query=yes', 'https://coast.example#fragment']) {
    expect((await probe({ORIGIN:origin})).code).not.toBe(0);
  }
});

test('installed adapter matches its reviewed pin and patch', async () => {
  await checkBunAdapter();
});
