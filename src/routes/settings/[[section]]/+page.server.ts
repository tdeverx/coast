import { settingsSections, administratorSettings } from '$lib/settings/sections';
import type { PageServerLoad } from './$types';
import { getPendingConflicts } from '$lib/sync/conflicts';
import { error } from '@sveltejs/kit';
import { requireAdmin, listUsers } from '$lib/server/auth';
import { listProviders } from '$lib/providers/instances.server';
import { getConfig } from '$lib/server/config';
import { systemHealth, listDiagnostics } from '$lib/server/notifications';
import { listActions } from '$lib/server/queue';
import { getSql, getDb } from '$lib/server/db';
import {
  mediaRequests,
  media,
  providerInstances,
  providerConnections,
  users,
} from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';
import { adminDemand } from '$lib/collection/demand.server';
export const load = (async ({ locals, params, depends, url }) => {
  depends('coast:settings');
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
      syncConflictWinner: 'manual',
      shareDemand:true,
      listenThreshold:50,
      fullWidth: true,
      originalTitles: false,
      region: 'GB',
      subtitleLanguages: config.subtitleLanguages,
      subtitlesAlways: config.subtitleDefault === 'always',
      subtitlePrompt: false,
      notificationsSilenced: false,
    },
    health: section === 'admin' ? await systemHealth(locals.user) : null,
    demand: section === 'admin' ? adminDemand(url) : null,
    users: section === 'users' ? await listUsers(locals.user) : [],
    actions: ['admin', 'jobs'].includes(section) ? await listActions(locals.user) : [],
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
