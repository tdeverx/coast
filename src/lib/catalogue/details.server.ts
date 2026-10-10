import { creditRoles } from '$lib/media/credits';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../server/db/index';
import * as s from '../server/db/schema';
import { getTmdb, ingestMetadata } from '$lib/catalogue/service.server';
import { mediaViewsForIds } from '../server/queries/media';
import { getTraktCommunity } from '$lib/providers/trakt/connection.server';
import { providerCache } from '../server/utils/provider-cache';
import { mapConcurrent } from '../server/utils/async';
import type { MediaInsights, PersonDetails } from '$lib/media/details';
import { error } from '@sveltejs/kit';
const insightsCache = providerCache<MediaInsights>(100, 15 * 60_000, (value) => !value.incomplete);
const peopleCache = providerCache<PersonDetails>();
async function viewerRegion(userId: string) {
  const [user] = await getDb()
    .select({ settings: s.users.settings })
    .from(s.users)
    .where(eq(s.users.id, userId));
  return user?.settings.region ?? 'GB';
}
export async function titleInsights(userId: string, id: string, source: string, page = 1) {
  const db = getDb();
  const [media] = await db.select().from(s.media).where(eq(s.media.id, id));
  if (!media) error(404, 'This title was not found.');
  const [season] =
    media.kind === 'season'
      ? await db.select().from(s.seasons).where(eq(s.seasons.mediaId, id))
      : [];
  const [episode] =
    media.kind === 'episode'
      ? await db.select().from(s.episodes).where(eq(s.episodes.mediaId, id))
      : [];
  const child = season ?? episode;
  const [identity] = await db
    .select()
    .from(s.externalIds)
    .where(and(eq(s.externalIds.mediaId, child?.showId ?? id), eq(s.externalIds.provider, 'tmdb')));
  if (!identity) return null;
  if (source === 'trakt') {
    if (media.kind === 'collection') return null;
    const community = await getTraktCommunity();
    if (!community) return null;
    return insightsCache(`trakt:${community.instanceId}:${id}:${page}`, async () => {
      const { adapter } = community;
      const ids = await adapter.lookupIds(
        media.kind === 'movie' ? 'movie' : 'show',
        identity.externalId
      );
      if (!ids) error(404, 'This title is not listed on Trakt.');
      const path = `/${media.kind === 'movie' ? 'movies' : 'shows'}/${ids.trakt}${child ? `/seasons/${child.seasonNumber}` : ''}${episode ? `/episodes/${episode.episodeNumber}` : ''}`;
      return adapter.community(path, page);
    });
  }
  const region = await viewerRegion(userId),
    adapter = await getTmdb('en-US', region);
  if (!adapter || media.kind === 'collection') return null;
  const path = `${media.kind === 'movie' ? 'movie' : 'tv'}/${encodeURIComponent(identity.externalId)}${child ? `/season/${child.seasonNumber}` : ''}${episode ? `/episode/${episode.episodeNumber}` : ''}`;
  return insightsCache(`tmdb:${region}:${path}:${page}`, () => adapter.insights(path, page));
}
export async function personDetails(id: number) {
  const adapter = await getTmdb();
  if (!adapter) error(503, 'Configure TMDB to view people and their credits.');
  return peopleCache(String(id), () => adapter.person(id));
}
export async function personCredits(
  userId: string,
  id: number,
  options: {
    type?: string;
    department?: string;
    page?: number;
    scope?: string;
    available?: boolean;
  } = {}
) {
  const person = await personDetails(id);
  const matches = person.credits.filter(
    (c) =>
      (!options.type || options.type === 'all' || c.metadata.kind === options.type) &&
      (!options.department ||
        options.department === 'all' ||
        c.department === options.department ||
        c.creditDepartment === options.department)
  );
  const merged = new Map<string, (typeof matches)[number]>();
  for (const c of matches) {
    const key = `${c.metadata.kind}:${c.metadata.externalId}`,
      old = merged.get(key);
    if (old) {
      if (c.role && !old.role.split(' · ').includes(c.role))
        merged.set(key, { ...old, role: [old.role, c.role].filter(Boolean).join(' · ') });
    } else merged.set(key, { ...c });
  }
  let credits = [...merged.values()];
  if (options.scope === 'library' || options.available) {
    const identities = credits.length
      ? await getDb()
          .select()
          .from(s.externalIds)
          .where(
            and(
              eq(s.externalIds.provider, 'tmdb'),
              inArray(s.externalIds.mediaKind, ['movie', 'show']),
              inArray(
                s.externalIds.externalId,
                credits.map((c) => c.metadata.externalId)
              )
            )
          )
      : [];
    const views = await mediaViewsForIds(
      userId,
      identities.map((i) => i.mediaId)
    );
    const available = new Set(views.filter((i) => i.available).map((i) => i.id));
    const keys = new Set(
      identities
        .filter((i) => available.has(i.mediaId))
        .map((i) => `${i.mediaKind}:${i.externalId}`)
    );
    credits = credits.filter((c) => keys.has(`${c.metadata.kind}:${c.metadata.externalId}`));
  }
  credits.sort(
    options.scope === 'known'
      ? (a, b) => b.popularity - a.popularity
      : (a, b) => (b.metadata.releaseDate ?? '').localeCompare(a.metadata.releaseDate ?? '')
  );
  const total = credits.length,
    pages = Math.max(1, Math.ceil(total / 24)),
    page = Math.min(Math.max(1, options.page ?? 1), pages);
  const selected = credits.slice((page - 1) * 24, page * 24);
  // Only materialize the visible page, never import an entire filmography.
  const saved = await mapConcurrent(selected, 4, (c) => ingestMetadata(c.metadata));
  const views = new Map(
    (
      await mediaViewsForIds(
        userId,
        saved.map((s) => s.id)
      )
    ).map((m) => [m.id, m])
  );
  return {
    items: saved.flatMap((m, index) => {
      const view = views.get(m.id);
      const roles = creditRoles(selected[index].role);
      const caption = [
        roles.preview,
        roles.remaining ? `+${roles.remaining} ${roles.remaining === 1 ? 'role' : 'roles'}` : '',
        roles.voice ? 'Voice' : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return view ? [{ ...view, captionSubtitle: caption, creditRoles: roles }] : [];
    }),
    departments: [
      ...new Set(
        person.credits.map(
          (c) => c.creditDepartment ?? (c.department === 'acting' ? 'Acting' : 'Crew')
        )
      ),
    ].sort(),
    total,
    page,
    pages,
  };
}
