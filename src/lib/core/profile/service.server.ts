import { logDiagnostic, classifyFailure } from '#lib/server/diagnostics/index.js';
import * as v from 'valibot';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { users, works, trackingState, type ProfileSettings } from '#lib/server/db/schema.js';
import { AppError } from '#lib/server/security/errors.js';
import { avatarRequestLimit, avatarImage, storeAvatar, pruneAvatars } from './avatar-storage.server';
const uuid = v.pipe(v.string(), v.uuid());
const position = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(100));
const profileText = {
  displayName: v.pipe(v.string(), v.trim(), v.maxLength(60)),
  bio: v.pipe(v.string(), v.trim(), v.maxLength(240)),
};
const profileInput = v.variant('action', [
  v.object({
    action: v.literal('edit'),
    ...profileText,
    avatar: v.nullable(v.pipe(v.string(), v.maxLength(avatarRequestLimit))),
    background: v.optional(v.object({ mediaId: uuid, position: v.nullable(v.object({ x: position, y: position })) })),
  }),
  v.object({
    action: v.literal('preferences'),
    period: v.optional(v.picklist(['month', 'year', 'all'])),
    favouriteKind: v.optional(v.picklist(['all', 'movie', 'show', 'album', 'track', 'game', 'book', 'comic'])),
  }),
  v.object({
    action: v.literal('position'),
    value: position,
  }),
  v.object({ action: v.literal('details'), ...profileText }),
  v.object({ action: v.literal('background'), mediaId: v.nullable(uuid) }),
  v.object({ action: v.literal('background-mode'), mode: v.picklist(['fixed','activity']) }),
  v.object({ action: v.literal('pin'), mediaId: uuid, value: v.boolean() }),
  v.object({ action: v.literal('move'), mediaId: uuid, beforeId: v.nullable(uuid) }),
]);
function setBackground(profile: ProfileSettings, mediaId: string | null) {
  profile.backgroundMediaId = mediaId;
  profile.backgroundMode = mediaId ? 'fixed' : 'activity';
  profile.backgroundPosition = 50;
  delete profile.backgroundPositionX;
}
export async function updateProfile(userId: string, input: unknown) {
  const data = v.parse(profileInput, input);
  const image=data.action==='edit'&&data.avatar&&!data.avatar.startsWith(`/api/v1/profile/avatar/${userId}/`)
    ?avatarImage(data.avatar):undefined;
  let previousAvatar:string|null|undefined;
  const result = await getDb().transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
    if (!user) throw new AppError(404, 'Account not found.');
    const profile: ProfileSettings = { ...user.settings.profile };
    if (data.action === 'edit') {
      if (data.background) {
        if (profile.backgroundMode === 'activity' || profile.backgroundMediaId !== data.background.mediaId)
          throw new AppError(409, 'The profile background changed. Reopen editing to adjust it.');
        const crop = data.background.position;
        if (crop) {
          profile.backgroundPositionX = crop.x;
          profile.backgroundPosition = crop.y;
        } else setBackground(profile, null);
      }
      previousAvatar=profile.avatar;
      if (data.avatar?.startsWith('/api/') && data.avatar !== profile.avatar)
        throw new AppError(400, 'Choose your own profile icon.');
      const avatar = image ? await storeAvatar(userId,image) : data.avatar;
      Object.assign(profile, { displayName: data.displayName, bio: data.bio, avatar });
    }
    else if (data.action === 'details') Object.assign(profile,{displayName:data.displayName,bio:data.bio});
    else if (data.action === 'preferences') {
      if (data.period !== undefined) profile.period = data.period;
      if (data.favouriteKind !== undefined) profile.favouriteKind = data.favouriteKind;
    } else if (data.action === 'position') profile.backgroundPosition = data.value;
    else if (data.action === 'background-mode') {
      profile.backgroundMode = data.mode;
    } else if (data.action === 'background') {
      if (data.mediaId) {
        const [item] = await tx
          .select({ id: works.id })
          .from(works)
          .where(and(eq(works.id, data.mediaId), sql`coast_category_enabled(${userId}::uuid,${works.category})`));
        if (!item) throw new AppError(404, 'Title not found.');
      }
      setBackground(profile, data.mediaId);
    } else {
      const favourites = await tx
        .select({ id: trackingState.mediaId })
        .from(trackingState)
        .where(and(eq(trackingState.userId, userId), eq(trackingState.favourite, true)))
        .orderBy(desc(trackingState.updatedAt), trackingState.mediaId);
      const ids = new Set(favourites.map((item) => item.id));
      if (
        !ids.has(data.mediaId) ||
        (data.action === 'move' && data.beforeId && !ids.has(data.beforeId))
      )
        throw new AppError(400, 'Choose a title from your favourites.');
      profile.pinnedFavourites = (profile.pinnedFavourites ?? []).filter((id) => ids.has(id));
      profile.favouriteOrder = (profile.favouriteOrder ?? []).filter((id) => ids.has(id));
      if (data.action === 'pin') {
        profile.pinnedFavourites = profile.pinnedFavourites.filter((id) => id !== data.mediaId);
        if (data.value) {
          if (profile.pinnedFavourites.length >= 50)
            throw new AppError(400, 'You can pin up to 50 favourites.');
          profile.pinnedFavourites.push(data.mediaId);
        }
      } else {
        const order = [...new Set([...profile.favouriteOrder, ...ids])].filter(
          (id) => id !== data.mediaId
        );
        const position = data.beforeId ? order.indexOf(data.beforeId) : order.length;
        if (position < 0 || data.beforeId === data.mediaId)
          throw new AppError(400, 'Choose a different favourite.');
        order.splice(position, 0, data.mediaId);
        if (order.length > 2000)
          throw new AppError(400, 'Custom ordering supports up to 2,000 favourites.');
        profile.favouriteOrder = order;
      }
    }
    const settings = { ...user.settings, profile };
    await tx
      .update(users)
      .set({
        settings,
      })
      .where(and(eq(users.id, userId), sql`${users.settings} is distinct from ${settings}::jsonb`));
    return profile;
  });
  if (data.action === 'edit') await pruneAvatars(userId,previousAvatar).catch(cause=>{void logDiagnostic('warn','application.failed',{operation:'settings',failure:classifyFailure(cause)});});
  return result;
}
