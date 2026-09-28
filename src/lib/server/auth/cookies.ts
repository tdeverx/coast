import type { Cookies } from '@sveltejs/kit';
export const SESSION_COOKIE = 'coast_session';

export function setSessionCookie(cookies: Cookies, token: string, expiresAt: Date, url: URL) {
  cookies.set(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
    expires: expiresAt,
  });
}
// Explicitly permit clearing LAN HTTP cookies; SvelteKit otherwise defaults Secure on non-localhost.
export function deleteSessionCookie(cookies: Cookies) {
  cookies.delete(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: false });
}
