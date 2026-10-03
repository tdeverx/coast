import {onboardingPending} from '$lib/server/auth/onboarding';
import {isPublicReadPath} from '$lib/social/public.server';
import { context, logDiagnostic, classifyFailure, diagnosticStore } from '$lib/server/diagnostics';
import { correlationId } from '$lib/diagnostics';
import { featureEnabled } from '$lib/experimental';
import { experimentalPathFeature } from '$lib/server/experimental';
import { refreshDiagnosticConfig, getConfig } from '$lib/server/config';
import { building } from '$app/environment';
import { redirect, json, error, isRedirect, isHttpError, type Handle } from '@sveltejs/kit';
import { authenticateSession, setupRequired } from '$lib/server/auth';
import { SESSION_COOKIE, setSessionCookie } from '$lib/server/auth/cookies';
import { assertSameOrigin } from '$lib/server/security/csrf';
import { initializePlatform } from '$lib/server/startup';
import { registerProviderActions } from '$lib/providers/actions.server';

export const init: import('@sveltejs/kit').ServerInit = async () => {
  if (!building) await initializePlatform(registerProviderActions);
};

const applicationHandle: Handle = async ({ event, resolve }) => {
  if (building) return resolve(event);
  await initializePlatform(registerProviderActions);
  // Public API handlers authenticate only scoped machine tokens, never browser cookies.
  if (event.url.pathname.startsWith('/api/public/v1/')) return resolve(event);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(event.request.method)) {
    try {
      assertSameOrigin(event.request);
    } catch {
      return json(
        { error: 'This request could not be verified. Reload Coast and try again.' },
        { status: 403 }
      );
    }
  }
  event.locals.user = null;
  event.locals.expiresAt = null;
  event.locals.setup = false;
  if (event.url.pathname === '/api/v1/health') return resolve(event);
  const session = await authenticateSession(event.cookies.get(SESSION_COOKIE));
  if (session) {
    event.locals.user = session.user;
    event.locals.expiresAt = session.expiresAt;
    if (session.token) setSessionCookie(event.cookies, session.token, session.expiresAt, event.url);
  }
  if (event.url.pathname === '/share' || event.url.pathname.startsWith('/api/share/')) {
    const response=await resolve(event);
    response.headers.set('Cache-Control','private, no-store');
    response.headers.set('Referrer-Policy','no-referrer');
    response.headers.set('X-Content-Type-Options','nosniff');
    response.headers.set('X-Frame-Options','DENY');
    response.headers.delete('link');
    return response;
  }
  event.locals.setup = await setupRequired();
  const config=await getConfig();
  const isPublic = ['/login', '/setup', '/register'].includes(event.url.pathname) || (['GET','HEAD'].includes(event.request.method) && isPublicReadPath(event.url.pathname,config.siteAccess));
  if (!event.locals.user && !isPublic) {
    if (event.url.pathname.startsWith('/api/'))
      return json({ error: 'Your session has expired. Sign in to continue.' }, { status: 401 });
    redirect(303, event.locals.setup ? '/setup' : '/login');
  }
  if (event.locals.setup && !['/setup'].includes(event.url.pathname))
    redirect(303, '/setup');
  const onboardingImageRead=event.request.method==='GET' && !!event.locals.user && (
    /^\/api\/v1\/profile\/avatars(?:\/[0-9a-f-]{36})?$/.test(event.url.pathname) ||
    event.url.pathname.startsWith(`/api/v1/profile/avatar/${event.locals.user.id}/`)
  );
  if (event.locals.user && !['/onboarding','/logout'].includes(event.url.pathname) && !onboardingImageRead && await onboardingPending(event.locals.user.id)) {
    if (event.url.pathname.startsWith('/api/')) return json({error:'Finish account setup and your initial imports before continuing.',code:'onboarding_required'},{status:403});
    redirect(303,'/onboarding');
  }
  const experimentalFeature = experimentalPathFeature(event.url.pathname);
  if (experimentalFeature && !featureEnabled(await getConfig(), experimentalFeature)) {
    if (event.url.pathname.startsWith('/api/'))
      return json(
        { error: 'Experimental features are disabled.', code: 'experimental_disabled' },
        { status: 404, headers: { 'cache-control': 'private, no-store' } }
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
  const id = correlationId(event.request.headers.get('x-coast-correlation-id'));
  return context.run(id, async () => {
    await refreshDiagnosticConfig();
    const started = performance.now();
    const diagnosticRequest = event.url.pathname.startsWith('/api/v1/diagnostics');
    const segment = event.url.pathname.split('/')[3];
    const operation = [
      'playback',
      'providers',
      'settings',
      'admin',
      'media',
      'collection',
      'library',
      'progress',
      'lists',
      'notifications',
      'requests',
    ].includes(segment)
      ? segment
      : ['collection', 'library', 'progress'].includes(event.url.pathname.split('/')[1])
        ? event.url.pathname.split('/')[1]
        : ['login', 'setup', 'logout'].includes(event.url.pathname.split('/')[1])
          ? 'auth'
          : 'other';
    if (!diagnosticRequest)
      void logDiagnostic('debug', 'request.start', { method: event.request.method, operation });
    try {
      const response = await applicationHandle({ event, resolve });
      response.headers.set('x-coast-correlation-id', id);
      response.headers.set('x-coast-diagnostic-level', diagnosticStore.level);
      // Ingestion and level polling must not log their own traffic.
      if (!diagnosticRequest)
        void logDiagnostic(
          response.status >= 500 ? 'error' : response.status >= 400 ? 'warn' : 'info',
          'request.complete',
          {
            method: event.request.method,
            operation,
            status: response.status,
            durationMs: performance.now() - started,
          }
        );
      return response;
    } catch (error) {
      if (isRedirect(error) || isHttpError(error)) {
        if (!diagnosticRequest)
          void logDiagnostic(error.status >= 400 ? 'warn' : 'info', 'request.complete', {
            operation,
            status: error.status,
            method: event.request.method,
            durationMs: performance.now() - started,
          });
      } else
        void logDiagnostic('error', 'request.failed', {
          operation,
          failure: classifyFailure(error),
          durationMs: performance.now() - started,
        });
      throw error;
    }
  });
};
export const handleError: import('@sveltejs/kit').HandleServerError = ({ error }) => {
  void logDiagnostic('error', 'application.failed', { failure: classifyFailure(error) });
  return { message: 'The application could not complete this request.' };
};
