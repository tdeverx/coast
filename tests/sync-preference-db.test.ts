import { beforeAll, afterAll, test, expect } from 'bun:test';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/lib/server/db';
import {
  users,
  media,
  movies,
  providerInstances,
  providerConnections,
  syncValues,
  ratings,
  lists,
  listItems,
  syncListValues,
  outboxActions,
  externalIds,
} from '../src/lib/server/db/schema';
import { reconcileProviderValue } from '../src/lib/sync/values.server';
import { reconcileProviderList } from '../src/lib/sync/list-values.server';
import { updateUserSettings } from '../src/lib/server/auth';

const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
let userId: string,
  otherId: string,
  itemId: string,
  instanceId: string,
  secondInstanceId: string,
  firstId: string,
  secondId: string,
  foreignId: string;
beforeAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  const people = await getDb()
    .insert(users)
    .values([
      { username: `pref-${crypto.randomUUID()}`, passwordHash: 'fixture' },
      { username: `pref-other-${crypto.randomUUID()}`, passwordHash: 'fixture' },
    ])
    .returning();
  [userId, otherId] = people.map((p) => p.id);
  const [instance] = await getDb()
    .insert(providerInstances)
    .values({ provider: 'trakt', name: 'Preference fixture', baseUrl: 'https://api.trakt.tv' })
    .returning();
  instanceId = instance.id;
  const [secondInstance] = await getDb()
    .insert(providerInstances)
    .values({
      provider: 'trakt',
      name: 'Second preference fixture',
      baseUrl: 'https://api.trakt.tv',
    })
    .returning();
  secondInstanceId = secondInstance.id;
  const connections = await getDb()
    .insert(providerConnections)
    .values(
      [userId, userId, otherId].map((id, index) => ({
        userId: id,
        instanceId: index === 1 ? secondInstanceId : instanceId,
        externalUserId: `fixture-${index}`,
        status: 'connected' as const,
        settings: { sync: { ratings: true, lists: true } },
      }))
    )
    .returning();
  [firstId, secondId, foreignId] = connections.map((c) => c.id);
  const [item] = await getDb()
    .insert(media)
    .values({ kind: 'movie', title: 'Preference fixture' })
    .returning();
  itemId = item.id;
  await getDb().insert(movies).values({ mediaId: itemId });
  await getDb()
    .insert(externalIds)
    .values({ mediaId: itemId, provider: 'tmdb', externalId: '98765', mediaKind: 'movie' });
});
afterAll(async () => {
  if (!userId) return;
  await getDb().delete(users).where(eq(users.id, userId));
  await getDb().delete(users).where(eq(users.id, otherId));
  await getDb().delete(media).where(eq(media.id, itemId));
  await getDb().delete(providerInstances).where(eq(providerInstances.id, instanceId));
  await getDb().delete(providerInstances).where(eq(providerInstances.id, secondInstanceId));
});
async function preference(value: string) {
  await getDb()
    .update(users)
    .set({ settings: { syncConflictWinner: value } })
    .where(eq(users.id, userId));
}
async function baseline() {
  await getDb().delete(syncValues).where(eq(syncValues.mediaId, itemId));
  await getDb().delete(outboxActions).where(eq(outboxActions.userId, userId));
  await getDb()
    .insert(ratings)
    .values({ userId, mediaId: itemId, value: 4 })
    .onConflictDoUpdate({ target: [ratings.userId, ratings.mediaId], set: { value: 4 } });
  await getDb()
    .insert(syncValues)
    .values({
      connectionId: firstId,
      mediaId: itemId,
      category: 'ratings',
      remote: { value: 2 },
      agreed: { value: 2 },
    });
}
run(
  'manual is default; preferred fresh account resolves and exports the winning value once',
  async () => {
    await baseline();
    expect(await reconcileProviderValue(userId, firstId, itemId, 'ratings', { value: 3 })).toBe(
      'conflict'
    );
    await preference(secondId);
    expect(await reconcileProviderValue(userId, firstId, itemId, 'ratings', { value: 3 })).toBe(
      'conflict'
    );
    expect(await reconcileProviderValue(userId, secondId, itemId, 'ratings', { value: 1 })).toBe(
      'remote'
    );
    expect((await getDb().select().from(ratings).where(eq(ratings.mediaId, itemId)))[0].value).toBe(
      1
    );
    const states = await getDb().select().from(syncValues).where(eq(syncValues.mediaId, itemId));
    expect(states.every((s) => !s.conflict && s.agreed?.value === 1)).toBe(true);
    const actions = await getDb()
      .select()
      .from(outboxActions)
      .where(eq(outboxActions.userId, userId));
    expect(actions.some((a) => a.connectionId === firstId && a.payload.value === 1)).toBe(true);
    expect(await reconcileProviderValue(userId, secondId, itemId, 'ratings', { value: 1 })).toBe(
      'agree'
    );
    expect(
      await getDb().select().from(outboxActions).where(eq(outboxActions.userId, userId))
    ).toHaveLength(actions.length);
  }
);
run(
  'Coast preference retains local edits and disconnected preferred accounts require review',
  async () => {
    await baseline();
    await preference('coast');
    expect(await reconcileProviderValue(userId, firstId, itemId, 'ratings', { value: 3 })).toBe(
      'local'
    );
    expect(
      (await getDb().select().from(syncValues).where(eq(syncValues.mediaId, itemId)))[0].agreed
    ).toEqual({ value: 4 });
    await baseline();
    await preference(firstId);
    await getDb()
      .update(providerConnections)
      .set({ status: 'disconnected' })
      .where(eq(providerConnections.id, firstId));
    expect(await reconcileProviderValue(userId, firstId, itemId, 'ratings', { value: 3 })).toBe(
      'conflict'
    );
    await getDb()
      .update(providerConnections)
      .set({ status: 'connected' })
      .where(eq(providerConnections.id, firstId));
  }
);
run(
  'preferred list account replaces conflicting title and membership, including deletion',
  async () => {
    await preference(firstId);
    const [list] = await getDb()
      .insert(lists)
      .values({
        userId,
        name: 'Local name',
        description: '',
        sourceConnectionId: firstId,
        externalId: 'pref-list',
      })
      .returning();
    await getDb().insert(listItems).values({ listId: list.id, mediaId: itemId, position: 0 });
    await getDb()
      .insert(syncListValues)
      .values({
        connectionId: firstId,
        listId: list.id,
        remote: { name: 'Original', description: '', items: [] },
        agreed: { name: 'Original', description: '', items: [] },
      });
    expect(
      await reconcileProviderList(userId, firstId, list.id, {
        name: 'Remote name',
        description: 'Remote description',
        items: [],
      })
    ).toBe('remote');
    expect((await getDb().select().from(lists).where(eq(lists.id, list.id)))[0].name).toBe(
      'Remote name'
    );
    expect(
      await getDb().select().from(listItems).where(eq(listItems.listId, list.id))
    ).toHaveLength(0);
    await reconcileProviderList(userId, firstId, list.id, {
      name: '',
      description: '',
      items: [],
      deleted: true,
    });
    expect(await getDb().select().from(lists).where(eq(lists.id, list.id))).toHaveLength(0);
  }
);
run(
  'preferences reject another user’s service and retain a saved unavailable preference',
  async () => {
    const [user] = await getDb().select().from(users).where(eq(users.id, userId));
    const prefs = {
      fullWidth: true,
      originalTitles: false,
      region: 'GB',
      notificationsSilenced: false,
      subtitleLanguages: ['en'],
      subtitlesAlways: false,
      subtitlePrompt: false,
    };
    await expect(
      updateUserSettings(user, { ...prefs, syncConflictWinner: foreignId })
    ).rejects.toThrow('your connected accounts');
    expect(
      (await updateUserSettings(user, { ...prefs, syncConflictWinner: 'manual' }))
        .syncConflictWinner
    ).toBe('manual');
  }
);
