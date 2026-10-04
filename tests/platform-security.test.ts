import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isAllowedAddress,
  secureProviderFetch,
  validateProviderUrl,
} from '../src/lib/server/security/provider-fetch';
import { assertSameOrigin } from '../src/lib/server/security/csrf';
import { requireAdmin, hashToken, randomToken } from '../src/lib/server/auth';
import { safeFields } from '../src/lib/diagnostics';
import { retryDelayMs } from '../src/lib/server/queue';

describe('provider network boundary', () => {
  test('header and body timeouts stay distinct from caller cancellation',async()=>{
    const original=globalThis.fetch;
    const config={baseUrl:'https://1.1.1.1',approved:true,timeoutMs:20};
    try {
      globalThis.fetch=Object.assign(async(_url:unknown,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
        if(init?.signal?.aborted)reject(init.signal.reason);
        else init?.signal?.addEventListener('abort',()=>reject(init.signal?.reason),{once:true});
      }),{preconnect:original.preconnect});
      await expect(secureProviderFetch(config,'/slow-headers')).rejects.toMatchObject({name:'TimeoutError'});
      const caller=new AbortController();caller.abort(new DOMException('Cancelled by caller','AbortError'));
      await expect(secureProviderFetch(config,'/cancelled',{signal:caller.signal})).rejects.toMatchObject({name:'AbortError'});
      globalThis.fetch=Object.assign(async(_url:unknown,init?:RequestInit)=>new Response(new ReadableStream({
        start(controller){init?.signal?.addEventListener('abort',()=>controller.error(init.signal?.reason),{once:true});}
      })),{preconnect:original.preconnect});
      await expect(secureProviderFetch(config,'/slow-body')).rejects.toMatchObject({name:'TimeoutError'});
    } finally {globalThis.fetch=original;}
  });
  test('rejects loopback, metadata, special and rebinding targets even with LAN approval', () => {
    for (const ip of [
      '127.0.0.1',
      '0.0.0.0',
      '169.254.169.254',
      '100.64.0.1',
      '224.0.0.1',
      '192.0.2.4',
      '198.18.0.1',
      '::',
      '::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '64:ff9b::7f00:1',
      '2002:7f00:1::',
      '2001:db8::1',
    ]) {
      expect(isAllowedAddress(ip, false), ip).toBe(false);
      expect(isAllowedAddress(ip, true), ip).toBe(false);
    }
  });
  test('LAN approval permits only private LAN ranges; public targets remain usable', () => {
    for (const ip of [
      '10.0.0.2',
      '172.16.1.1',
      '192.168.1.2',
      'fd42::1',
      'fc00::1234',
      '::ffff:192.168.1.3',
    ]) {
      expect(isAllowedAddress(ip, false)).toBe(false);
      expect(isAllowedAddress(ip, true)).toBe(true);
    }
    for (const ip of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])
      expect(isAllowedAddress(ip)).toBe(true);
  });
  test('requires approval, permitted protocol/port and configured reverse-proxy prefix', () => {
    expect(() => validateProviderUrl({ baseUrl: 'https://example.com' })).toThrow('administrator');
    expect(() => validateProviderUrl({ baseUrl: 'ftp://example.com', approved: true })).toThrow();
    expect(() =>
      validateProviderUrl({ baseUrl: 'https://secret@example.com', approved: true })
    ).toThrow();
    expect(() => validateProviderUrl({ baseUrl: 'http://example.com:22', approved: true })).toThrow(
      'port'
    );
    expect(() =>
      validateProviderUrl({ baseUrl: 'https://example.com/jellyfin', approved: true }, '../private')
    ).toThrow('path');
    expect(
      validateProviderUrl(
        { baseUrl: 'https://example.com/jellyfin', approved: true },
        '/System/Info/Public'
      ).href
    ).toBe('https://example.com/jellyfin/System/Info/Public');
  });
  test('rejects a redirect and bounds a decoded response without leaking cookies', async () => {
    const original = globalThis.fetch;
    let options: any;
    try {
      globalThis.fetch = Object.assign(
        async (_url: any, init: any) => {
          options = init;
          return new Response('redirect', {
            status: 302,
            headers: { location: 'http://127.0.0.1' },
          });
        },
        { preconnect: original.preconnect }
      );
      await expect(
        secureProviderFetch({ baseUrl: 'https://1.1.1.1', approved: true }, '/x', {
          headers: { Cookie: 'coast_session=secret' },
        })
      ).rejects.toThrow('redirect');
      expect(options.proxy).toBe(false);
      expect(options.redirect).toBe('manual');
      expect(options.headers.has('Cookie')).toBe(false);
      expect(options.tls.serverName).toBe('1.1.1.1');
      globalThis.fetch = Object.assign(async () => new Response('more than four bytes'), {
        preconnect: original.preconnect,
      });
      await expect(secureProviderFetch(
        { baseUrl: 'https://1.1.1.1', approved: true },
        '/x',
        {},
        { maxBytes: 4 }
      )).rejects.toThrow('size limit');
    } finally {
      globalThis.fetch = original;
    }
  });
});

test('state-changing browser requests require a matching Origin', () => {
  expect(() =>
    assertSameOrigin(new Request('https://coast.test/api', { method: 'POST' }))
  ).toThrow();
  expect(() =>
    assertSameOrigin(
      new Request('https://coast.test/api', {
        method: 'POST',
        headers: { Origin: 'https://attacker.test' },
      })
    )
  ).toThrow();
  expect(() =>
    assertSameOrigin(
      new Request('https://coast.test/api', {
        method: 'POST',
        headers: { Origin: 'https://coast.test' },
      })
    )
  ).not.toThrow();
});

let directory: string;
test('provider credentials use authenticated encryption and a persisted non-plaintext key', async () => {
  directory = await mkdtemp(join(tmpdir(), 'coast-secrets-test-'));
  // The application caches its key for its process lifetime. Keep this test independent of DB suites.
  const child = Bun.spawn(
    [
      process.execPath,
      '--eval',
      `
      import { encryptCredential, decryptCredential } from './src/lib/server/security/credentials.ts';
      const first = await encryptCredential('provider-secret');
      const second = await encryptCredential('provider-secret');
      const plain = await decryptCredential(first);
      const parts = first.split('.');
      const bytes = Buffer.from(parts[2], 'base64url');
      bytes[0] ^= 1;
      parts[2] = bytes.toString('base64url');
      let rejected = false;
      try { await decryptCredential(parts.join('.')); } catch { rejected = true; }
      console.log(JSON.stringify({ first, second, plain, rejected }));
    `,
    ],
    {
      cwd: join(import.meta.dir, '..'),
      env: { ...process.env, COAST_DATA_DIR: directory },
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );
  const output = await new Response(child.stdout).text();
  const failure = await new Response(child.stderr).text();
  expect(await child.exited, failure).toBe(0);
  const { first, second, plain, rejected } = JSON.parse(output);
  expect(first).not.toBe(second);
  expect(first).not.toContain('provider-secret');
  expect(plain).toBe('provider-secret');
  expect(rejected).toBe(true);
  expect((await readFile(join(directory, 'secrets', 'credentials.key'))).length).toBe(32);
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('session secrets are random and hashed; admin checks execute on the server', async () => {
  const first = randomToken();
  expect(first.length).toBe(43);
  expect(randomToken()).not.toBe(first);
  expect(await hashToken(first)).not.toContain(first);
  expect(() => requireAdmin(null)).toThrow();
  expect(() =>
    requireAdmin({ id: 'user', username: 'user', email: null, role: 'user', settings: {} })
  ).toThrow('Administrator');
});
test('diagnostics exclude nested credentials and URLs', () => {
  expect(
    safeFields({
      password: 'secret',
      child: { accessToken: 'secret' },
      url: 'https://server/path?api_key=secret&ok=1',
    })
  ).toEqual({});
});
test('queue retry has bounded exponential delay and no expiry', () => {
  expect(retryDelayMs(1)).toBe(5000);
  expect(retryDelayMs(3)).toBe(20_000);
  expect(retryDelayMs(100)).toBe(6 * 60 * 60_000);
});
