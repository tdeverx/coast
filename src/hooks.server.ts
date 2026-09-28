import { building } from '$app/environment';
import { redirect, json, type Handle } from '@sveltejs/kit';
import { authenticateSession, setupRequired } from '$lib/server/auth';
import { SESSION_COOKIE, setSessionCookie } from '$lib/server/auth/cookies';
import { assertSameOrigin } from '$lib/server/security/csrf';
import { initializePlatform } from '$lib/server/startup';
import { registerProviderActions } from '$lib/providers/service';

export const init: import('@sveltejs/kit').ServerInit = async () => {
  if (!building) await initializePlatform(registerProviderActions);
};

export const handle: Handle = async ({ event, resolve }) => {
  if (building) return resolve(event);
  await initializePlatform(registerProviderActions);
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
  event.locals.setup = await setupRequired();
  const isPublic = ['/login', '/setup', '/recovery'].includes(event.url.pathname);
  if (!event.locals.user && !isPublic) {
    if (event.url.pathname.startsWith('/api/'))
      return json({ error: 'Your session has expired. Sign in to continue.' }, { status: 401 });
    redirect(303, event.locals.setup ? '/setup' : '/login');
  }
  if (event.locals.setup && !['/setup', '/recovery'].includes(event.url.pathname))
    redirect(303, '/setup');
  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'same-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  if (event.locals.user) response.headers.set('Cache-Control', 'private, no-store');
  return response;
};
