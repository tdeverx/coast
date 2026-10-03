import type { LayoutServerLoad } from './$types';
import { getConfig } from '$lib/server/config';
import { notificationUnread } from '$lib/server/notifications/inbox';
import {incomingFriendRequests} from '$lib/social/service.server';
import { inbox } from '$lib/server/notifications';
export const load = (async ({ locals, depends }) => {
  depends('coast:session', 'coast:notifications', 'coast:social');
  const config=await getConfig();
  const [notifications,unreadNotifications,friendRequestCount]=locals.user?await Promise.all([inbox(locals.user),notificationUnread(locals.user),incomingFriendRequests(locals.user.id)]):[[],0,0];
  return {
    publicRead:config.siteAccess==='public-read-only',
    experimentalFeatures: config.experimentalFeatures,
    user: locals.user,
    expiresAt: locals.expiresAt?.toISOString() ?? null,
    unreadNotifications,
    friendRequestCount,
    notifications,
  };
}) satisfies LayoutServerLoad;
