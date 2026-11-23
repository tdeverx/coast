import { fail } from '@sveltejs/kit';
import { safeParse } from 'valibot';
import { registrationSchema } from '#lib/auth/registration.js';
import { authArtwork } from '#lib/auth/artwork.server.js';
import { profilePath } from '#lib/profile/url.js';
import { getSql } from '#lib/server/db/index.js';
import { getConfig } from '#lib/server/config.js';
import type { Actions, PageServerLoad } from './$types';

const previewInviteCode = 'COAST-PREVIEW-MapPSwyTL-nm8pWhnYRfgorRij_dl';

export const load: PageServerLoad = async () => {
  const config = await getConfig();
  const [host] = config.siteAccess === 'private' ? [] : await getSql()`
    select id, username, settings#>>'{profile,avatar}' as avatar from users
    where not disabled and (membership_expires_at is null or membership_expires_at>now())
      and social_visible(id,null,'details') order by created_at,id limit 1`;
  return {
    previewInviter:host ? {name:String(host.username),profile:profilePath(host.username),
      avatar:host.avatar?.startsWith(`/api/v1/profile/avatar/${host.id}/`) ? String(host.avatar) : null} : null,
    artwork: await authArtwork(),
    registrationMode: config.registrationMode,
    registrationProvider: config.registrationProvider,
    enableTrakt: config.enableTrakt,
    allowCustomJellyfinUrl: config.allowArbitraryServers,
    previewInviteCode,
  };
};

function inviteFailure() {
  const message = 'Use the invite code for this preview.';
  return fail(400, { mode: 'register' as const, inviteError: message, error: message });
}

export const actions = {
  // Preview submissions exercise feedback without creating accounts or sessions.
  login: async ({ request }) => {
    const fields = await request.formData();
    const name = fields.get('username'), password = fields.get('password');
    if (typeof name === 'string' && name.trim() && name.length <= 32 && typeof password === 'string' && password.length && password.length <= 128) {
      switch (fields.get('previewLogin')) {
        case 'pending': return { mode: 'login' as const, onboarding: { name } };
        case 'returning': return { mode: 'login' as const, destination: 'For You' };
        case 'library': return { mode: 'login' as const, destination: 'Library' };
      }
    }
    return fail(400, { mode: 'login' as const, error: 'Check your username and password.' });
  },
  verifyInvite: async ({ request }) => {
    if ((await request.formData()).get('code') !== previewInviteCode) return inviteFailure();
    return { mode: 'register' as const, inviteValid: true };
  },
  register: async ({ request }) => {
    const fields = Object.fromEntries(await request.formData());
    const registration = safeParse(registrationSchema, {
      ...fields, displayName: fields.username,
    });
    if (!registration.success) return fail(400, { mode: 'register' as const, error: registration.issues[0].message });
    const registrationMode = fields.previewRegistration ?? (await getConfig()).registrationMode;
    if (registrationMode !== 'open' && registration.output.code !== previewInviteCode) return inviteFailure();
    return { mode: 'register' as const, onboarding: { name: registration.output.username } };
  },
} satisfies Actions;
