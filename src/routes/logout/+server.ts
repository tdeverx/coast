import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { logout } from '$lib/server/auth';
import { SESSION_COOKIE, deleteSessionCookie } from '$lib/server/auth/cookies';
export const POST: RequestHandler = async ({ cookies }) => {
  await logout(cookies.get(SESSION_COOKIE));
  deleteSessionCookie(cookies);
  redirect(303, '/login');
};
