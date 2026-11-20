import * as v from 'valibot';
import { profileUser } from '#lib/server/queries/profile-user.js';
import { AppError } from '#lib/server/security/errors.js';
import { withReadCancellation } from '#lib/server/db/read-cancellation.js';
import { profileBackground, profileData, profileActivity, profileOptionsSchema } from '#lib/server/queries/profile.js';
import { activityFiltersSchema } from '#lib/social/model.js';
import { comparisonMediaValues } from '#lib/social/taste.js';
import { sectionTarget } from '#lib/ui/section-target.js';
import { profilePath } from './url.js';

const tasteFilters = v.object({
  page: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100_000)),
  medium: v.picklist(comparisonMediaValues),
  overlap: v.picklist(['shared', 'onlyYou', 'onlyFriend']),
});

async function loadTaste(viewerId: string, friendId: string, url: URL, signal?: AbortSignal) {
  const parsed = v.safeParse(tasteFilters, {
    page: Number(url.searchParams.get('page') ?? 1),
    medium: url.searchParams.get('medium') ?? 'all',
    overlap: url.searchParams.get('overlap') ?? 'shared',
  });
  if (!parsed.success) throw new AppError(400, 'Choose a valid overlap view and page.');
  const { friendInsights } = await import('#lib/social/insights.server.js');
  signal?.throwIfAborted();
  const comparison = await friendInsights(viewerId, friendId, parsed.output, signal);
  signal?.throwIfAborted();
  const { workCards } = await import('#lib/collection/query.server.js');
  const items = await withReadCancellation(signal, () => workCards(viewerId, viewerId, comparison.ids));
  signal?.throwIfAborted();
  const media = comparison.media.map(({ medium, score, signals, stats, overlapCounts, progressComparisons }) =>
    ({ medium, score, signals, stats, overlapCounts, progressComparisons }));
  return {
    comparison: { score: comparison.score, sampleLimit: comparison.sampleLimit, total: comparison.total, page: comparison.page, pages: comparison.pages, media },
    items,
    medium: parsed.output.medium,
    overlap: parsed.output.overlap,
  };
}

export type ProfileTaste = Awaited<ReturnType<typeof loadTaste>>;

export async function loadProfileRow(username: string, viewerId: string | null, url: URL, signal?: AbortSignal) {
  const section = url.searchParams.get('section');
  if (section !== 'list' && section !== 'progress') return null;
  const target = sectionTarget(url.pathname + url.search, url);
  if (!target) throw new AppError(400, 'Choose a valid profile row.');
  signal?.throwIfAborted();
  const user = await profileUser(username);
  if (section === 'list' && viewerId !== user.id) throw new AppError(404, 'Profile section not found.');
  if (section === 'progress' && !viewerId) throw new AppError(404, 'Profile section not found.');
  signal?.throwIfAborted();
  const background = await withReadCancellation(signal, () => profileBackground(user.id, viewerId, user.settings.profile));
  signal?.throwIfAborted();
  return {
    username: user.username,
    href: profilePath(user.username) + url.search,
    artwork: background?.backdrop || background?.artwork?.backdrop || background?.poster || background?.artwork?.primary,
  };
}
export async function loadProfileDetails(username: string, viewerId: string | null, url: URL, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const user = await profileUser(username, viewerId ?? undefined);
  signal?.throwIfAborted();
  const isOwner = user.id === viewerId;
  const section = url.searchParams.get('section');
  const showLists = section === 'lists';
  const showTaste = section === 'taste';
  if (showLists && !isOwner) throw new AppError(404, 'Profile section not found.');
  if (showTaste && (!viewerId || !isOwner && !user.canCompareTaste)) throw new AppError(404, 'Taste is unavailable.');
  const parsed = v.safeParse(profileOptionsSchema, {
    scope: url.searchParams.get('scope') ?? 'all',
    view: showLists || showTaste ? 'overview' : url.searchParams.get('view') ?? 'overview',
    kind: url.searchParams.get('kind') ?? user.settings.profile?.favouriteKind ?? 'all',
    period: url.searchParams.get('period') ?? user.settings.profile?.period ?? 'all',
    query: url.searchParams.get('q') ?? '',
    activityKind: url.searchParams.get('type') ?? 'all',
    repeats: url.searchParams.get('repeats') === 'true',
    rating: url.searchParams.has('rating') ? Number(url.searchParams.get('rating')) : undefined,
    genre: url.searchParams.get('genre') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    page: Number(url.searchParams.get('page') ?? 1),
  });
  if (!parsed.success) throw new AppError(400, 'Choose a valid profile view and page.');
  if (parsed.output.from && parsed.output.to && parsed.output.from > parsed.output.to)
    throw new AppError(400, 'The start date must be before the end date.');
  const now = new Date();
  const headerOnly = showLists || showTaste || section === 'activity' && parsed.output.view === 'overview';
  const [details, taste, personalTaste] = await Promise.all([
    withReadCancellation(signal, () => profileData(user.id, parsed.output, now, viewerId, headerOnly)),
    showTaste && viewerId && !isOwner ? loadTaste(viewerId, user.id, url, signal) : null,
    showTaste && isOwner ? withReadCancellation(signal, async () =>
      (await import('#lib/social/taste-cache.server.js')).personalTaste(user.id)) : null,
  ]);
  signal?.throwIfAborted();
  const activityMedia = [...new Set(details.activityCategories.map(category =>
    category === 'book' || category === 'comic' ? 'reading' : category))];
  const activityFilters = section === 'activity' ? v.safeParse(activityFiltersSchema, Object.fromEntries(url.searchParams)) : null;
  if (section === 'activity' && (!viewerId || !activityMedia.length))
    throw new AppError(404, 'Profile activity is unavailable.');
  if (activityFilters && !activityFilters.success) throw new AppError(400, 'Choose a valid activity filter.');
  const medium = url.searchParams.get('category');
  const activity =
    section === 'insights' && details.visibility.insights
      ? profileActivity(user.id, now, parsed.output.period, viewerId).catch(() => null)
      : Promise.resolve(null);
  const lists = showLists ? await (await import('#lib/core/lists/service.server.js')).getLists(user.id) : null;
  signal?.throwIfAborted();
  return {
    ...details,
    username: user.username,
    userId: user.id,
    activityMedia,
    activityFeed: activityFilters?.success ? {
      ...activityFilters.output,
      category: medium && activityMedia.includes(medium) ? medium : activityMedia.includes('screen') ? 'screen' : activityMedia[0],
    } : null,
    isOwner,
    canCompareTaste: user.canCompareTaste,
    taste: taste && { ...taste, viewerId },
    personalTaste,
    activity,
    lists,
  };
}
