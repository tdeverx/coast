import { logDiagnostic, classifyFailure, context } from '../diagnostics';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError } from './errors';

export interface ProviderFetchConfig {
  baseUrl: string;
  provider?: 'jellyfin' | 'trakt' | 'tmdb' | 'seerr' | 'igdb';
  approved?: boolean;
  allowPrivateNetwork?: boolean;
  allowedPorts?: number[];
  timeoutMs?: number;
  maxResponseBytes?: number;
}

function ipv6Number(address: string): bigint {
  let text = address.toLowerCase();
  if (text.includes('.')) {
    const last = text.lastIndexOf(':');
    const bytes = text
      .slice(last + 1)
      .split('.')
      .map(Number);
    text = `${text.slice(0, last)}:${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }
  const halves = text.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const words =
    halves.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
      : left;
  return words.reduce((n, part) => (n << 16n) | BigInt(`0x${part}`), 0n);
}

/** Private LANs can be explicitly approved; loopback, link-local and transition ranges never can. */
export function isAllowedAddress(address: string, allowPrivate = false): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split('.').map(Number);
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))
      return allowPrivate;
    if (
      a === 0 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    )
      return false;
    if (
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    )
      return false;
    return true;
  }
  if (version !== 6 || address.includes('%')) return false;
  const n = ipv6Number(address);
  if (n >> 32n === 0xffffn) {
    const v4 = Number(n & 0xffffffffn);
    return isAllowedAddress(
      [v4 >>> 24, (v4 >>> 16) & 255, (v4 >>> 8) & 255, v4 & 255].join('.'),
      allowPrivate
    );
  }
  if (n >> 121n === 0x7en) return allowPrivate; // fc00::/7 (ULA)
  if (n >> 125n !== 1n) return false; // Only global unicast 2000::/3 otherwise.
  if (
    n >> 112n === 0x2002n ||
    n >> 96n === 0x20010db8n ||
    n >> 105n === 0x20010000000000000000000000000000n >> 105n
  )
    return false;
  return true;
}

export function validateProviderUrl(config: ProviderFetchConfig, path = ''): URL {
  if (!config.approved)
    throw new AppError(403, 'An administrator must approve this service instance.');
  let base: URL;
  try {
    base = new URL(config.baseUrl);
  } catch {
    throw new AppError(400, 'Enter a valid server URL.');
  }
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.hash ||
    base.search
  )
    throw new AppError(
      400,
      'Service URLs must be HTTP or HTTPS without credentials, queries or fragments.'
    );
  const port = Number(base.port || (base.protocol === 'https:' ? 443 : 80));
  if (!(config.allowedPorts || [80, 443, 8096, 8920, 5055]).includes(port))
    throw new AppError(403, 'This service port is not allowed.');
  // A provider path cannot change the approved origin or escape a configured reverse-proxy prefix.
  const prefix = base.pathname.replace(/\/$/, '');
  const target = new URL(`${base.origin}${prefix}/${path.replace(/^\/+/, '')}`);
  if (target.origin !== base.origin || (prefix && !target.pathname.startsWith(`${prefix}/`)))
    throw new AppError(403, 'The service path is not allowed.');
  return target;
}

function limitedBody(
  body: ReadableStream<Uint8Array>,
  max: number,
  controller: AbortController,
  timeout: number,
  diagnostics: { provider: ProviderFetchConfig['provider']; correlationId?: string }
) {
  const reader = body.getReader();
  let bytes = 0;
  return new ReadableStream<Uint8Array>({
    async pull(output) {
      const timer = setTimeout(
        () => controller.abort(new Error('Service response timed out.')),
        timeout
      );
      try {
        const result = await reader.read();
        if (result.done) {
          output.close();
          return;
        }
        bytes += result.value.byteLength;
        if (bytes > max) {
          void logDiagnostic(
            'error',
            'provider.failed',
            { provider: diagnostics.provider, failure: 'validation' },
            diagnostics.correlationId
          );
          controller.abort();
          await reader.cancel();
          output.error(new Error('Service response exceeded its size limit.'));
          return;
        }
        output.enqueue(result.value);
      } catch (error) {
        void logDiagnostic(
          'error',
          'provider.failed',
          {
            provider: diagnostics.provider,
            failure: controller.signal.aborted ? 'timeout' : classifyFailure(error),
          },
          diagnostics.correlationId
        );
        output.error(error);
      } finally {
        clearTimeout(timer);
      }
    },
    async cancel(reason) {
      controller.abort();
      await reader.cancel(reason);
    },
  });
}

async function providerFetch(
  config: ProviderFetchConfig,
  path: string,
  init: RequestInit = {},
  options: { stream?: boolean; maxBytes?: number } = {}
): Promise<Response> {
  const original = validateProviderUrl(config, path);
  const host = original.hostname.replace(/^\[|\]$/g, '');
  const timeout = config.timeoutMs || 15_000;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('The service did not respond in time.')),
    timeout
  );
  const signal = init.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  try {
    const addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await Promise.race([
          lookup(host, { all: true, verbatim: true }),
          new Promise<never>((_, reject) =>
            signal.addEventListener(
              'abort',
              () => reject(new Error('Service DNS lookup timed out.')),
              { once: true }
            )
          ),
        ]);
    if (
      !addresses.length ||
      addresses.some(({ address }) => !isAllowedAddress(address, config.allowPrivateNetwork))
    )
      throw new AppError(403, 'This service resolves to a restricted network address.');
    const chosen = addresses[0];
    const pinned = new URL(original);
    pinned.hostname = chosen.family === 6 ? `[${chosen.address}]` : chosen.address;
    const headers = new Headers(init.headers);
    headers.set('Host', original.host);
    headers.delete('Cookie');
    headers.delete('Proxy-Authorization');
    const fetchOptions = {
      ...init,
      headers,
      signal,
      redirect: 'manual',
      proxy: false,
      ...(original.protocol === 'https:'
        ? { tls: { serverName: host, rejectUnauthorized: true } }
        : {}),
    };
    // Bun supports proxy:false; bun-types currently omits that value. Never inherit a proxy.
    const response = await fetch(pinned, fetchOptions as RequestInit);
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      await response.body?.cancel();
      throw new AppError(502, 'The service returned a redirect. Configure its final URL.');
    }
    const max =
      options.maxBytes ||
      (options.stream ? 32 * 1024 ** 3 : config.maxResponseBytes || 8 * 1024 ** 2);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > max) {
      await response.body?.cancel();
      throw new AppError(502, 'The service response is too large.');
    }
    return new Response(
      response.body
        ? limitedBody(response.body, max, controller, options.stream ? 30_000 : timeout, {
            provider: config.provider,
            correlationId: context.getStore(),
          })
        : null,
      { status: response.status, statusText: response.statusText, headers: response.headers }
    );
  } finally {
    clearTimeout(timer);
  }
}

export class ProviderHttpError extends Error {
  constructor(
    public status: number,
    public retryAfterSeconds: number | null = null
  ) {
    super(`The connected service returned HTTP ${status}.`);
    this.name = 'ProviderHttpError';
  }
}

export function createProviderTransport(config: ProviderFetchConfig) {
  return async (path: string, init: RequestInit = {}): Promise<unknown> => {
    const response = await secureProviderFetch(config, path, init);
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderHttpError(
        response.status,
        Number(response.headers.get('retry-after')) || null
      );
    }
    if (response.status === 204 || response.headers.get('content-length') === '0') return null;
    const text = await response.text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new AppError(502, 'The connected service returned an invalid response.');
    }
  };
}

export async function secureProviderFetch(
  config: ProviderFetchConfig,
  path: string,
  init: RequestInit = {},
  options: { stream?: boolean; maxBytes?: number } = {}
): Promise<Response> {
  const started = performance.now();
  void logDiagnostic('trace', 'provider.start', {
    provider: config.provider,
    method: init.method || 'GET',
    stream: !!options.stream,
  });
  try {
    const response = await providerFetch(config, path, init, options);
    void logDiagnostic(response.ok ? 'info' : 'warn', 'provider.complete', {
      provider: config.provider,
      method: init.method || 'GET',
      status: response.status,
      failure: response.ok ? undefined : 'http',
      durationMs: performance.now() - started,
      stream: !!options.stream,
    });
    return response;
  } catch (error) {
    void logDiagnostic('error', 'provider.failed', {
      provider: config.provider,
      failure: classifyFailure(error),
      durationMs: performance.now() - started,
    });
    throw error;
  }
}
