import * as v from 'valibot';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { users, media, trackingState, type ProfileSettings } from '$lib/server/db/schema';
import { AppError } from '$lib/server/security/errors';
import { avatarRequestLimit, gifBytes, storeGifAvatar, pruneGifAvatars } from './gif-avatar.server';
const uuid = v.pipe(v.string(), v.uuid());
const profileInput = v.variant('action', [
  v.object({
    action: v.literal('edit'),
    displayName: v.pipe(v.string(), v.trim(), v.maxLength(60)),
    bio: v.pipe(v.string(), v.trim(), v.maxLength(240)),
    avatar: v.nullable(v.pipe(v.string(), v.maxLength(avatarRequestLimit))),
  }),
  v.object({
    action: v.literal('preferences'),
    period: v.optional(v.picklist(['month', 'year', 'all'])),
    favouriteKind: v.optional(v.picklist(['all', 'movie', 'show'])),
  }),
  v.object({
    action: v.literal('feature'),
    mediaId: v.nullable(uuid),
    note: v.pipe(v.string(), v.trim(), v.maxLength(300)),
  }),
  v.object({
    action: v.literal('position'),
    value: v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(100)),
  }),
  v.object({ action: v.literal('background'), mediaId: v.nullable(uuid) }),
  v.object({ action: v.literal('background-mode'), mode: v.picklist(['fixed','activity']) }),
  v.object({ action: v.literal('pin'), mediaId: uuid, value: v.boolean() }),
  v.object({ action: v.literal('move'), mediaId: uuid, beforeId: v.nullable(uuid) }),
]);
export async function updateProfile(userId: string, input: unknown) {
  const data = v.parse(profileInput, input);
  if (data.action === 'edit' && data.avatar && !data.avatar.startsWith(`/api/v1/profile/avatar/${userId}/`)) {
    if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(data.avatar))
      throw new AppError(400, 'Choose a PNG, JPEG, WebP or GIF avatar.');
    if (data.avatar.startsWith('data:image/gif;')) gifBytes(data.avatar);
    else if (data.avatar.length > 220000) throw new AppError(400, 'Choose a smaller image.');
    const bytes = Buffer.from(data.avatar.split(',')[1], 'base64');
    const valid = data.avatar.startsWith('data:image/png;')
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : data.avatar.startsWith('data:image/jpeg;')
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : data.avatar.startsWith('data:image/gif;')
          ? ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))
          : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!valid) throw new AppError(400, 'The avatar is not a valid image.');
  }
  const result = await getDb().transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
    if (!user) throw new AppError(404, 'Account not found.');
    const profile: ProfileSettings = { ...user.settings.profile };
    if (data.action === 'edit') {
      if (data.avatar?.startsWith('/api/') && data.avatar !== profile.avatar)
        throw new AppError(400, 'Choose your own profile icon.');
      const avatar = data.avatar?.startsWith('data:image/gif;')
        ? await storeGifAvatar(userId, data.avatar) : data.avatar;
      Object.assign(profile, { displayName: data.displayName, bio: data.bio, avatar });
    }
    else if (data.action === 'preferences') {
      if (data.period !== undefined) profile.period = data.period;
      if (data.favouriteKind !== undefined) profile.favouriteKind = data.favouriteKind;
    } else if (data.action === 'position') profile.backgroundPosition = data.value;
    else if (data.action === 'feature') {
      if (data.mediaId) {
        const [fav] = await tx
          .select()
          .from(trackingState)
          .where(
            and(
              eq(trackingState.userId, userId),
              eq(trackingState.mediaId, data.mediaId),
              eq(trackingState.favourite, true)
            )
          );
        if (!fav) throw new AppError(400, 'Choose one of your favourites to feature.');
      }
      profile.featuredMediaId = data.mediaId;
      profile.featuredNote = data.note;
    } else if (data.action === 'background-mode') {
      profile.backgroundMode = data.mode;
    } else if (data.action === 'background') {
      if (data.mediaId) {
        const [item] = await tx
          .select({ id: media.id })
          .from(media)
          .where(eq(media.id, data.mediaId));
        if (!item) throw new AppError(404, 'Title not found.');
      }
      profile.backgroundMediaId = data.mediaId;
      profile.backgroundMode = 'fixed';
      profile.backgroundPosition = 50;
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
    await tx
      .update(users)
      .set({
        settings: { ...user.settings, profile },
      })
      .where(eq(users.id, userId));
    return profile;
  });
  if (data.action === 'edit') await pruneGifAvatars(userId);
  return result;
}
