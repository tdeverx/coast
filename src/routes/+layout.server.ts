import {resolveAction} from '#lib/actions.js';
import { getFeatureConfig } from '#lib/server/features.js';
import type { LayoutServerLoad } from './$types';
import { notificationUnread } from '#lib/server/notifications/inbox.js';
import {incomingFriendRequests} from '#lib/social/service.server.js';
import { inbox } from '#lib/server/notifications/index.js';
import { contentRevision } from '#lib/server/content-revision.server.js';
export const load = (async ({ locals, depends,params,url }) => {
  depends('coast:session', 'coast:notifications', 'coast:social', 'coast:tracking', 'coast:planning');
  const config=await getFeatureConfig(locals.user?.id??null);
  const viewedUsername=params.username??url.searchParams.get('username');
  const [notifications,unreadNotifications,friendRequestCount,revision]=locals.user?await Promise.all([inbox(locals.user),notificationUnread(locals.user),config.features.social?incomingFriendRequests(locals.user.id):0,contentRevision(locals.user.id,viewedUsername)]):[[],0,0,null];
  return {
    action:resolveAction(url.searchParams,locals.user?.settings.action,config),
    capabilities:config.features,
    publicRead:config.siteAccess==='public-read-only',
    developerMode:locals.user?.role==='admin'&&config.developerMode,
    featuredHeroIds:locals.user?.role==='admin'?config.featuredHeroIds:undefined,
    publicProfiles:config.siteAccess==='public-profiles',
    experimentalMusic: config.experimentalMusic,
    experimentalGaming: config.experimentalGaming,
    experimentalBooks: config.experimentalBooks,
    experimentalComics: config.experimentalComics,
    experimentalParties: config.experimentalParties,
    experiments:{planning:config.experimentalPlanning},
    playbackSharing:config.allowPlaybackSharing && !!locals.user && (locals.user.role==='admin'||locals.user.settings.allowPlaybackSharing===true),
    allowVrchatHevc:config.allowVrchatHevc,
    user: locals.user,
    contentRevision: revision,
    expiresAt: locals.expiresAt?.toISOString() ?? null,
    unreadNotifications,
    friendRequestCount,
    notifications,
  };
}) satisfies LayoutServerLoad;
