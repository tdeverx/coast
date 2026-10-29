import {listTaskCommands} from '#lib/server/queue/task-commands.server.js';
import { resolveFeatures } from '#lib/features.js';
import {listShares} from '#lib/sharing/service.server.js';
import {listApiTokens} from '#lib/server/public-api/tokens.server.js';
import { collectionPreferences } from '#lib/collection/preferences.js';
import {listInvites} from '#lib/server/auth/onboarding.js';
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
  providerConnections,
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
  return {
    section,
    featureDecisions: resolveFeatures(config),
    benchmarks:section==='benchmarks'?await listBenchmarks(locals.user,Number(url.searchParams.get('page'))||1):null,
    playbackLinks:section==='playback'?await listShares(locals.user):[],
    apiTokens:section==='api'?await listApiTokens(locals.user):[],
    invites: section==='users'?await listInvites(locals.user):[],
    hasLocalPassword:
      section === 'account'
        ? (
            await getSql()`SELECT password_hash IS NOT NULL AS present FROM users WHERE id = ${locals.user!.id}`
          )[0]?.present === true
        : false,
    supportConnections:
      section === 'users'
        ? await getDb()
            .select({
              userId: providerConnections.userId,
              provider: providerInstances.name,
              username: providerConnections.username,
              status: providerConnections.status,
              updatedAt: providerConnections.updatedAt,
            })
            .from(providerConnections)
            .innerJoin(providerInstances, eq(providerInstances.id, providerConnections.instanceId))
        : [],
    conflicts: section === 'pending' ? await getPendingConflicts(locals.user!.id) : [],
    providers: await listProviders(locals.user!.id, admin),
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
      notificationsSilenced: false,
    },
    health: section === 'admin' ? await systemHealth(locals.user) : null,
    demand: section === 'admin' ? adminDemand(url) : null,
    users: section === 'users' ? await listUsers(locals.user) : [],
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
