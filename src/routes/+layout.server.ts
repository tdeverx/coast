import type { LayoutServerLoad } from './$types';
import { getConfig } from '$lib/server/config';
import { notificationUnread } from '$lib/server/notifications/inbox';
import {incomingFriendRequests} from '$lib/social/service.server';
import { inbox } from '$lib/server/notifications';
import { contentRevision } from '$lib/server/content-revision.server';
export const load = (async ({ locals, depends,params,url }) => {
  depends('coast:session', 'coast:notifications', 'coast:social', 'coast:tracking', 'coast:planning');
  const config=await getConfig();
  const viewedUsername=params.username??url.searchParams.get('username');
  const [notifications,unreadNotifications,friendRequestCount,revision]=locals.user?await Promise.all([inbox(locals.user),notificationUnread(locals.user),incomingFriendRequests(locals.user.id),contentRevision(locals.user.id,viewedUsername)]):[[],0,0,null];
  return {
    publicRead:config.siteAccess==='public-read-only',
    developerMode:locals.user?.role==='admin'&&config.developerMode,
    publicProfiles:config.siteAccess==='public-profiles',
    experimentalMusic: config.experimentalMusic,
    experimentalGaming: config.experimentalGaming,
    experimentalBooks: config.experimentalBooks,
    experimentalComics: config.experimentalComics,
    experimentalParties: config.experimentalParties,
    experiments:{planning:config.experimentalPlanning,mediaModal:config.experimentalMediaModal},
    playbackSharing:config.allowPlaybackSharing && !!locals.user && (locals.user.role==='admin'||locals.user.settings.allowPlaybackSharing===true),
    user: locals.user,
    contentRevision: revision,
    expiresAt: locals.expiresAt?.toISOString() ?? null,
    unreadNotifications,
    friendRequestCount,
    notifications,
  };
}) satisfies LayoutServerLoad;
