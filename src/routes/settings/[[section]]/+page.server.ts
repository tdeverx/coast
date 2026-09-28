import type { PageServerLoad } from './$types';
import { getPendingConflicts } from '$lib/sync/conflicts';
import { error } from '@sveltejs/kit';
import { requireAdmin, listUsers } from '$lib/server/auth';
import { listProviders } from '$lib/providers/service';
import { getConfig } from '$lib/server/config';
import { systemHealth, listDiagnostics } from '$lib/server/notifications';
import { listActions } from '$lib/server/queue';
import { getDb } from '$lib/server/db';
import {
  mediaRequests,
  media,
  providerInstances,
  providerConnections,
  users,
} from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';
export const load = (async ({ locals, params, depends }) => {
  depends('coast:settings');
  const section = params.section ?? 'appearance';
  const valid = [
    'appearance',
    'playback',
    'account',
    'connections',
    'pending',
    'jobs',
    'admin',
    'integrations',
    'users',
    'policies',
    'activity',
  ];
  if (!valid.includes(section)) error(404, 'Settings page not found.');
  const admin = ['admin', 'integrations', 'users', 'policies', 'activity', 'jobs'].includes(
    section
  );
  if (admin) requireAdmin(locals.user);
  const config = await getConfig();
  return {
    section,
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
    defaults: {
      syncConflictWinner: 'manual',
      fullWidth: true,
      originalTitles: false,
      region: 'GB',
      subtitleLanguages: config.subtitleLanguages,
      subtitlesAlways: config.subtitleDefault === 'always',
      subtitlePrompt: false,
      notificationsSilenced: false,
    },
    health: section === 'admin' ? await systemHealth(locals.user) : null,
    users: section === 'users' ? await listUsers(locals.user) : [],
    actions: ['admin', 'jobs'].includes(section) ? await listActions(locals.user) : [],
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
