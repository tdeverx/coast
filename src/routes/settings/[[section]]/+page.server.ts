import {listTaskCommands} from '#lib/server/queue/task-commands.server.js';
import { resolveFeatures } from '#lib/features.js';
import {listShares} from '#lib/sharing/service.server.js';
import {listApiTokens} from '#lib/server/public-api/tokens.server.js';
import { collectionPreferences } from '#lib/collection/preferences.js';
import { settingsSections, administratorSettings } from '#lib/settings/sections.js';
import type { PageServerLoad } from './$types';
import { getPendingConflicts } from '#lib/sync/conflicts.server.js';
import { error } from '@sveltejs/kit';
import { requireAdmin, listUsers } from '#lib/server/auth/index.js';
import { listProviders } from '#lib/providers/instances.server.js';
import { getConfig } from '#lib/server/config.js';
import { systemHealth, listDiagnostics } from '#lib/server/notifications/index.js';
import { listActions, listTaskActions } from '#lib/server/queue/index.js';
import { getSql, getDb } from '#lib/server/db/index.js';
import {
  mediaRequests,
  media,
  providerInstances,
  users,
} from '#lib/server/db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { jobTimings } from '#lib/providers/job-timing.server.js';
import { adminDemand } from '#lib/collection/demand.server.js';
import { listBenchmarks } from '#lib/benchmarks/service.server.js';
export const load = (async ({locals, params, depends, url}) => {
  depends('coast:settings'); depends('coast:providers');

  const section = params.section ?? 'appearance';
  if (!settingsSections.some(([id]) => id === section)) error(404, 'Settings page not found.');
  const admin = administratorSettings.some(([id]) => id === section);
  if (admin) {
    try {
      requireAdmin(locals.user);
    } catch {
      error(403, 'Administrator access is required.');
    }
  }
  const config = await getConfig();
  const usersTab: 'users'|'invites'|'defaults'=section==='users' && url.searchParams.get('view')==='invites' ? 'invites' :
    section==='users' && url.searchParams.get('view')==='defaults' ? 'defaults' : 'users';
  const accounts=section==='users'&&usersTab==='users' ? await listUsers(locals.user,url.searchParams.get('before')) : {items:[],next:null};
  const inviteAuthorities=section==='users'&&usersTab!=='users' ? await getSql()<{id:string;name:string}[]>`select c.id,i.name||' · '||u.username as name
    from provider_connections c join users u on u.id=c.user_id and u.role='admin' and not u.disabled
    join provider_instances i on i.id=c.instance_id and i.provider='jellyfin' and i.enabled
    where c.status='connected' and c.credentials is not null order by i.name,u.username,c.id limit 40` : [];
  return {
    section,usersTab,accounts,inviteAuthorities,
    featureDecisions: resolveFeatures(config),
    benchmarks:section==='benchmarks'?await listBenchmarks(locals.user,Number(url.searchParams.get('page'))||1):null,
    backups: section === 'backups' ? await (await import('#lib/backups/service.server.js')).backupStatus(locals.user) : null,
    playbackLinks:section==='playback'?await listShares(locals.user):[],
    apiTokens:section==='api'?await listApiTokens(locals.user):[],
    hasLocalPassword:
      section === 'account'
        ? (
            await getSql()`SELECT password_hash IS NOT NULL AS present FROM users WHERE id = ${locals.user!.id}`
          )[0]?.present === true
        : false,
    conflicts: section === 'pending' ? await getPendingConflicts(locals.user!.id) : [],
    providers:section==='users'?[]:await listProviders(locals.user!.id, admin),
    config: admin ? config : null,
    allowNotificationSilencing: config.allowNotificationSilencing,
    defaults: {
      features: {},
      collection: collectionPreferences(locals.user?.settings.collection),
      social:{audience:'friends' as const,sections:{},categories:{},notifications:{}},
      syncConflictWinner: 'manual',
      shareDemand:true,
      listenThreshold:50,
      fullWidth: true,
      liquidGlass: true,
      originalTitles: false,
      monochromeMissing: true,
      sanitizeOddReadingPages: true,
      region: 'GB',
      subtitleLanguages: config.subtitleLanguages,
      subtitlesAlways: config.subtitleDefault === 'always',
      subtitlePrompt: false,
      notificationLevel: null,
    },
    health: section === 'admin' ? await systemHealth(locals.user) : null,
    demand: section === 'admin' ? adminDemand(url) : null,
    tasteJob:section==='jobs'?await (await import('#lib/social/taste-cache.server.js')).tasteJob():null,
    jobTiming: section === 'jobs' ? await jobTimings() : [],
    taskCommands:section==='jobs'?await listTaskCommands(locals.user):{items:[],more:false},
    actions: section === 'jobs' ? await listTaskActions(locals.user) : section === 'admin' ? await listActions(locals.user) : [],
    loggingAudit:
      section === 'activity'
        ? await getSql()`SELECT previous_level AS previous, next_level AS next, created_at AS "createdAt" FROM diagnostic_setting_audit ORDER BY created_at DESC LIMIT 30`
        : [],
    metadataAudit:
      section === 'activity'
        ? await getSql()`SELECT id, message, created_at AS "createdAt" FROM diagnostics WHERE kind = 'metadata_override' ORDER BY created_at DESC LIMIT 30`
        : [],
    diagnostics: ['activity', 'admin'].includes(section)
      ? await listDiagnostics(locals.user, 30)
      : [],
    requests:
      section === 'admin'
        ? await getDb()
            .select({
              request: mediaRequests,
              title: media.title,
              destination: providerInstances.name,
              username: users.username,
            })
            .from(mediaRequests)
            .innerJoin(media, eq(media.id, mediaRequests.mediaId))
            .innerJoin(providerInstances, eq(providerInstances.id, mediaRequests.instanceId))
            .innerJoin(users, eq(users.id, mediaRequests.userId))
            .orderBy(desc(mediaRequests.createdAt))
            .limit(30)
        : [],
  };
}) satisfies PageServerLoad;
