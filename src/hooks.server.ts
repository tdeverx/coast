import { redirect, error, isRedirect, isHttpError } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { getFeatureConfig } from '#lib/server/features.js';
import {managedRoute} from '#lib/server/auth/managed-library.server.js';
import {onboardingPending} from '#lib/server/auth/onboarding.js';
import {isPublicReadPath} from '#lib/social/public.server.js';
import { context, diagnosticRequest, logDiagnostic, classifyFailure, diagnosticStore, diagnosticErrorCode } from '#lib/server/diagnostics/index.js';
import { requestDiagnostics, requestDiagnosticLevel } from '#lib/server/diagnostics/request.js';
import { sampleSlowDatabaseUse } from '#lib/server/diagnostics/runtime.js';
import { correlationId } from '#lib/diagnostics.js';
import { featureEnabled } from '#lib/experimental.js';
import { experimentalPathFeature } from '#lib/server/experimental.js';

import {
  refreshDiagnosticConfig,
  withRequestConfig,
  withoutRequestConfig
} from '#lib/server/config.js';

import { building } from '$app/env';
import { authenticateSession, setupState } from '#lib/server/auth/index.js';
import { SESSION_COOKIE, setSessionCookie } from '#lib/server/auth/cookies.js';
import { assertSameOrigin } from '#lib/server/security/csrf.js';
import { initializePlatform, platformStopping } from '#lib/server/startup.js';
import { registerProviderActions } from '#lib/providers/actions.server.js';

export const init: import('@sveltejs/kit/hooks').ServerInit = async () => {
  if (!building) await initializePlatform(registerProviderActions);
};

const applicationHandle: Handle = async ({ event, resolve }) => {
  if (building) return resolve(event);
  if (platformStopping()) return Response.json({status:'unavailable'}, {status:503, headers:{'Cache-Control':'no-store'}});
  await withoutRequestConfig(() => initializePlatform(registerProviderActions));
  // Public API handlers authenticate only scoped machine tokens, never browser cookies.
  if (event.url.pathname.startsWith('/api/public/v1/')) return resolve(event);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(event.request.method)) {
    try {
      assertSameOrigin(event.request);
    } catch {
      return Response.json(
        { error: 'This request could not be verified. Reload Coast and try again.' },
        { status: 403 }
      );
    }
  }
  event.locals.user = null;
  event.locals.expiresAt = null;
  event.locals.setup = false;
  event.locals.needsTmdb = false;
  if (event.url.pathname === '/api/v1/health') return resolve(event);
  const session = await authenticateSession(event.cookies.get(SESSION_COOKIE));
  if (session) {
    event.locals.user = session.user;
    event.locals.expiresAt = session.expiresAt;
    if (session.token) setSessionCookie(event.cookies, session.token, session.expiresAt, event.url);
  }
  if (event.locals.user?.access?.libraryOnly && event.url.pathname !== '/setup' && !managedRoute(event.url.pathname,event.request.method)) {
    if (event.url.pathname.startsWith('/api/')) return Response.json({error:'This route is unavailable to Library-only accounts.'},{status:403});
    redirect(303,'/library');
  }
  if (event.url.pathname === '/share' || event.url.pathname.startsWith('/share/') || event.url.pathname.startsWith('/api/share/')) {
    const response=await resolve(event);
    response.headers.set('Cache-Control','private, no-store');
    response.headers.set('Referrer-Policy','no-referrer');
    response.headers.set('X-Content-Type-Options','nosniff');
    response.headers.set('X-Frame-Options','DENY');
    response.headers.delete('link');
    return response;
  }
  const setup = await setupState();
  event.locals.setup = setup.needsAccount;
  event.locals.needsTmdb = setup.needsTmdb;
  const config = await getFeatureConfig(event.locals.user?.id ?? null);
  const isPublic = ['/login', '/setup', '/register', '/invite'].includes(event.url.pathname) || ['GET', 'HEAD'].includes(event.request.method) && isPublicReadPath(event.url.pathname, config.siteAccess);
  if (!event.locals.user && !isPublic) {
    if (event.url.pathname.startsWith('/api/'))
      return Response.json({ error: 'Your session has expired. Sign in to continue.' }, { status: 401 });
    redirect(303, event.locals.setup ? '/setup' : '/login');
  }

  if (event.locals.setup && !['/setup'].includes(event.url.pathname)) redirect(303, '/setup');

  if (event.locals.needsTmdb && !['/setup','/login','/logout'].includes(event.url.pathname)) {
    if (event.url.pathname.startsWith('/api/')) return Response.json(
      {error:'A Coast administrator needs to connect TMDB to finish setup.',code:'tmdb_required'},
      {status:503,headers:{'Cache-Control':'private, no-store'}},
    );
    redirect(303,'/setup');
  }

  const onboardingImageRead = event.request.method === 'GET' && !!event.locals.user && ((/^\/api\/v1\/profile\/avatars(?:\/[0-9a-f-]{36})?$/).test(event.url.pathname) || event.url.pathname.startsWith(`/api/v1/profile/avatar/${event.locals.user.id}/`));

  if (event.locals.user && !['/onboarding', '/logout', '/setup'].includes(event.url.pathname) && !onboardingImageRead && await onboardingPending(event.locals.user.id)) {
    if (event.url.pathname.startsWith('/api/')) return Response.json(
      {
        error: 'Finish account setup and your initial imports before continuing.',
        code: 'onboarding_required'
      },
      { status: 403 }
    );

    redirect(303, '/onboarding');
  }
  const experimentalFeature = experimentalPathFeature(event.url.pathname);

  if (experimentalFeature && !(/\/synced\/[^/]+\/(leave|decline)$/).test(event.url.pathname) && !featureEnabled(config, experimentalFeature)) {
    if (event.url.pathname.startsWith('/api/')) return Response.json(
      {
        error: 'Experimental features are disabled.',
        code: 'experimental_disabled'
      },
      {
        status: 404,
        headers: { 'cache-control': 'private, no-store' }
      }
    );
    event.setHeaders({ 'cache-control': 'private, no-store' });
    error(404, 'Experimental features are disabled.');
  }
  const response = await resolve(event);
  // Page preload hints also live in the HTML. Duplicating every shared UI chunk
  // in Link can overflow ordinary reverse-proxy response-header buffers.
  if (response.headers.get('content-type')?.startsWith('text/html'))
    response.headers.delete('link');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'same-origin');
  // Only administrators may embed the isolated UI examples on this origin.
  response.headers.set(
    'X-Frame-Options',
    event.locals.user?.role === 'admin' && event.url.pathname === '/ui-preview/demo' ? 'SAMEORIGIN' : 'DENY'
  );
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
};

export const handle: Handle = async ({ event, resolve }) => {
  if (building) return resolve(event);
  if (platformStopping()) return Response.json({status:'unavailable'}, {status:503, headers:{'Cache-Control':'no-store'}});
  const id = correlationId(event.request.headers.get('x-coast-correlation-id'));
  const requestId = crypto.randomUUID();
  return withRequestConfig(() => context.run(id, () => diagnosticRequest.run(requestId, async () => {
    const started = performance.now();
    // Readiness must not first block on a separate, unbounded settings query.
    if (event.url.pathname !== '/api/v1/health') await refreshDiagnosticConfig();
    const self = event.url.pathname.startsWith('/api/v1/diagnostics');
    const fields = { ...requestDiagnostics(event.url), method: event.request.method };
    const complete = (status: number) => {
      if (self) return;
      const durationMs = performance.now() - started;
      void logDiagnostic(requestDiagnosticLevel(status, durationMs, fields.requestAction), 'request.complete',
        { ...fields, status, durationMs });
      if(durationMs>=4000&&status<500&&['library','progress','requests','media','discovery','collection'].includes(fields.operation))
        void sampleSlowDatabaseUse({...fields,durationMs});
    };
    if (!self)
      void logDiagnostic('debug', 'request.start', fields);
    try {
      const response = await applicationHandle({ event, resolve });
      response.headers.set('x-coast-correlation-id', id);
      response.headers.set('x-coast-request-id', requestId);
      response.headers.set('x-coast-diagnostic-level', diagnosticStore.level);
      // Ingestion and level polling must not log their own traffic.
      complete(response.status);
      return response;
    } catch (error) {
      if (isRedirect(error) || isHttpError(error)) {
        complete(error.status);
      } else if (!self) {
        const failure = classifyFailure(error);
        void logDiagnostic(failure === 'aborted' ? 'debug' : 'error', 'request.failed',
          { ...fields, failure, errorCode: diagnosticErrorCode(error), durationMs: performance.now() - started });
      }
      throw error;
    }
  })));
};
export const handleError: import('@sveltejs/kit/hooks').HandleServerError = ({ kind, error }) => {
  // Kit 3 also reports safe application/framework/validation errors here.
  if (kind !== 'unknown') return;
  void logDiagnostic('error', 'application.failed', { failure: classifyFailure(error) });
  return { message: 'The application could not complete this request.' };
};
