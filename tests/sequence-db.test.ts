import { afterAll, beforeAll, expect, test } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {
  addListItem,
  createList,
  getList,
  moveListItem,
  removeListItem,
} from '../src/lib/core/lists/service.server';
import {
  nextSequenceEntry,
  restartPlaylist,
  sequenceEntry,
  sequenceEntries,
} from '../src/lib/core/lists/sequence.server';
import { track, trackInTransaction } from '../src/lib/core/tracking/service.server';
import { deleteListWithExports } from '../src/lib/sync/trakt-lists.server';
import { bulkTrack } from '../src/lib/core/tracking/service.server';
import { setRewatch } from '../src/lib/core/tracking/rewatch.server';
import { mediaViewsForIds, sequenceNextView } from '../src/lib/server/queries/media';
import { continuationIds } from '../src/lib/server/queries/continuations';
import { listsData } from '../src/lib/server/queries/lists';
const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
let owner: string, other: string;
const [collection, nested, movie, show, season, ep1, ep2, special] = Array.from({ length: 8 }, () =>
  crypto.randomUUID()
);
const ids = [collection, nested, movie, show, season, ep1, ep2, special];
beforeAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  const people = await getDb()
    .insert(s.users)
    .values(
      ['owner', 'other'].map((name) => ({
        username: `sequence-${name}-${crypto.randomUUID()}`,
        passwordHash: 'fixture',
      }))
    )
    .returning();
  [owner, other] = people.map((row) => row.id);
  await getDb()
    .insert(s.media)
    .values([
      ...[collection, nested].map((id) => ({
        id,
        kind: 'collection' as const,
        title: 'Mixed collection',
      })),
      { id: movie, kind: 'movie', title: 'Movie', runtimeMinutes: 90 },
      { id: show, kind: 'show', title: 'Show' },
      { id: season, kind: 'season', title: 'Season' },
      ...[ep1, ep2, special].map((id) => ({ id, kind: 'episode' as const, title: 'Episode' })),
    ]);
  await getDb().insert(s.shows).values({ mediaId: show });
  await getDb().insert(s.seasons).values({ mediaId: season, showId: show, seasonNumber: 1 });
  await getDb()
    .insert(s.episodes)
    .values(
      [ep1, ep2, special].map((mediaId, i) => ({
        mediaId,
        showId: show,
        seasonId: season,
        seasonNumber: i === 2 ? 0 : 1,
        episodeNumber: i + 1,
        isSpecial: i === 2,
        runtimeMinutes: 30,
      }))
    );
  await getDb()
    .insert(s.mediaRelationships)
    .values([
      ...[special, movie, season, nested].map((childId, position) => ({
        parentId: collection,
        childId,
        position,
        kind: 'collection' as const,
      })),
      { parentId: nested, childId: collection, position: 0, kind: 'collection' },
    ]);
});
afterAll(async () => {
  if (!owner) return;
  await getDb()
    .delete(s.users)
    .where(inArray(s.users.id, [owner, other]));
  await getDb().delete(s.media).where(inArray(s.media.id, ids));
});
run(
  'mixed sequences preserve explicit order, expand seasons, include explicit specials and stop cycles',
  async () => {
    const source = { kind: 'collection' as const, id: collection };
    const entries = await sequenceEntries(owner, source);
    expect(entries.map((entry) => entry.mediaId)).toEqual([special, movie, ep1, ep2]);
    expect(entries[2].duration).toBe(1800);
    expect((await sequenceNextView(owner, source))?.id).toBe(special);
    expect((await sequenceNextView(owner, source))?.available).toBe(false);
    expect(nextSequenceEntry(entries, entries[0].entryId)?.mediaId).toBe(movie);
    expect(() => nextSequenceEntry(entries, 'removed')).toThrow();
    await track(owner, {
      mediaId: ep1,
      action: 'watch',
      occurredAt: '2020-01-01T00:00:00.000Z',
      acknowledged: true,
    });
    const planned = await continuationIds(owner, [ep1], false);
    expect(planned.sequenceNext.some((next) => next.source.id === collection)).toBe(true);
    await setRewatch(owner, { mediaId: collection, startedAt: '2025-01-01T00:00:00.000Z' });
    expect(
      (await sequenceEntries(owner, source)).find((entry) => entry.mediaId === ep1)?.watched
    ).toBe(false);
    expect((await mediaViewsForIds(owner, [ep1]))[0].watched).toBe(true);
    await bulkTrack(owner, {
      mediaId: collection,
      action: 'watch',
      acknowledged: true,
      includeSpecials: true,
    });
    expect((await sequenceEntries(owner, source)).every((entry) => entry.watched)).toBe(true);
  }
);
run(
  'playlist repetitions retain independent completion, progress and identity after moving or removing entries',
  async () => {
    const list = await createList(other, { name: 'Repeat sequence', playlist: true });
    for (const mediaId of [movie, season, movie]) await addListItem(other, list.id, mediaId);
    await restartPlaylist(other, list.id);
    const source = { kind: 'playlist' as const, id: list.id };
    let entries = await sequenceEntries(other, source);
    expect(entries.map((entry) => entry.mediaId)).toEqual([movie, ep1, ep2, movie]);
    expect(new Set(entries.map((entry) => entry.entryId)).size).toBe(4);
    for (const entry of entries)
      expect(await sequenceEntry(other, {...source,entryId:entry.entryId},entry.mediaId)).toEqual(entry);
    await expect(sequenceEntry(owner,{...source,entryId:entries[0].entryId},movie)).rejects.toMatchObject({status:404});
    const first = entries[0],
      repeated = entries[3];
    await track(other, {
      mediaId: movie,
      action: 'progress',
      positionSeconds: 45,
      durationSeconds: 5400,
      sequence: { ...source, entryId: repeated.entryId },
    });
    entries = await sequenceEntries(other, source);
    expect(entries[0].progress).toBe(0);
    expect(entries[3].progress).toBe(45);
    await track(other, {
      mediaId: movie,
      action: 'watch',
      acknowledged: true,
      sequence: { ...source, entryId: repeated.entryId },
    });
    entries = await sequenceEntries(other, source);
    expect(entries[0].watched).toBe(false);
    expect(entries[3].watched).toBe(true);
    expect(
      (await sequenceNextView(other, source, undefined, repeated.entryId))?.sequence?.entryId
    ).toBe(repeated.entryId);
    const rows = await listsData(other, { view: list.id });
    expect(rows.items.map((item) => item.entryId)).toEqual(
      (await getList(other, list.id)).items.map((item) => item.entryId)
    );
    expect(rows.items[0].watched).toBe(false);
    expect(rows.items[2].watched).toBe(true);
    await moveListItem(other, list.id, { entryId: repeated.entryId, direction: -1 });
    entries = await sequenceEntries(other, source);
    expect(entries[1].entryId).toBe(repeated.entryId);
    expect(entries[1].watched).toBe(true);
    await removeListItem(other, list.id, first.entryId);
    expect(
      (await getList(other, list.id)).items.filter((entry) => entry.item.id === movie)
    ).toHaveLength(1);
    expect((await sequenceEntries(other, source))[0].watched).toBe(true);
    await expect(sequenceEntries(owner, source)).rejects.toThrow();
    await expect(
      track(owner, {
        mediaId: movie,
        action: 'watch',
        sequence: { ...source, entryId: repeated.entryId },
      })
    ).rejects.toThrow();
    const history = await getDb()
      .select()
      .from(s.trackingEvents)
      .where(eq(s.trackingEvents.userId, other));
    await restartPlaylist(other, list.id);
    expect((await sequenceEntries(other, source))[0].watched).toBe(false);
    expect(
      (await getDb().select().from(s.trackingEvents).where(eq(s.trackingEvents.userId, other)))
        .length
    ).toBe(history.length);
    const regular = await createList(other, { name: 'Regular list' });
    await addListItem(other, regular.id, movie);
    await addListItem(other, regular.id, movie);
    expect((await getList(other, regular.id)).items).toHaveLength(1);
    expect(await deleteListWithExports(other, list.id)).toEqual({ deleted: true });
    await expect(getList(other, list.id)).rejects.toThrow();
  }
);

run('exact sequence reads preserve canonical paths, special rules and malformed cursor errors',async()=>{
  const source={kind:'collection' as const,id:collection};
  const entries=await sequenceEntries(owner,source);
  for(const entry of entries)
    expect(await sequenceEntry(owner,{...source,entryId:entry.entryId},entry.mediaId)).toEqual(entry);
  for(const entryId of ['not-a-uuid',`${collection}/%`,`${collection}/${movie}/ignored`,
    `${collection}/${season}/${special}`,`${collection}/${nested}/${collection}/${movie}`]){
    expect(await sequenceEntry(owner,{...source,entryId},movie)).toBeNull();
    await expect(track(owner,{mediaId:movie,action:'watch',acknowledged:true,sequence:{...source,entryId}}))
      .rejects.toMatchObject({message:'This sequence entry no longer exists.',status:400});
  }
  expect(await sequenceEntry(owner,{...source,entryId:`${collection}/${season}/${special}`},special)).toBeNull();
  const movieEntry=entries.find(entry=>entry.mediaId===movie)!;
  expect(await sequenceEntry(owner,{...source,entryId:movieEntry.entryId},ep1)).toBeNull();
  // A destructive catalogue write is a negative control, not a fabricated load benchmark.
  // Its rollback proves a previous census cannot authorize a now-removed occurrence.
  const rollback=new Error('Rollback occurrence removal');
  await expect(getDb().transaction(async tx=>{
    await tx.delete(s.mediaRelationships).where(and(eq(s.mediaRelationships.parentId,collection),eq(s.mediaRelationships.childId,movie),eq(s.mediaRelationships.kind,'collection')));
    expect(await sequenceEntry(owner,{...source,entryId:movieEntry.entryId},movie,tx)).toBeNull();
    await expect(trackInTransaction(tx,owner,{mediaId:movie,action:'watch',acknowledged:true,sequence:{...source,entryId:movieEntry.entryId}}))
      .rejects.toMatchObject({message:'This sequence entry no longer exists.',status:400});
    throw rollback;
  })).rejects.toBe(rollback);
  expect(await sequenceEntry(owner,{...source,entryId:movieEntry.entryId},movie)).toEqual(movieEntry);
});

run('batched sequence summaries and next entries preserve the explicit sequence semantics', async () => {
  const { sequenceSummaries, nextSequenceEntries } = await import('../src/lib/core/lists/sequence.server');
  const empty=crypto.randomUUID();
  await getDb().insert(s.media).values({id:empty,kind:'collection',title:'Empty sequence'});
  try {
    const sources=[{kind:'collection' as const,id:collection},{kind:'collection' as const,id:nested},{kind:'collection' as const,id:empty}];
    const summaries=await sequenceSummaries(owner,sources),next=await nextSequenceEntries(owner,sources);
    for(const source of sources){
      const entries=await sequenceEntries(owner,source);
      expect(summaries.get(`collection:${source.id}`)).toEqual({
        total:entries.length,completed:entries.filter(entry=>entry.watched).length,
        watched:entries.length>0&&entries.every(entry=>entry.watched),
        duration:entries.reduce((sum,entry)=>sum+entry.duration,0),
        progress:entries.reduce((sum,entry)=>sum+(entry.watched?entry.duration:entry.progress),0),
      });
      expect(next.get(`collection:${source.id}`)??null).toEqual(nextSequenceEntry(entries));
    }
    expect(summaries.get(`collection:${empty}`)?.total).toBe(0);
  } finally {await getDb().delete(s.media).where(eq(s.media.id,empty));}
});

run('selected playlist roots retain repeated entry identity and share the full sequence projection', async () => {
  const { nextSequenceEntries } = await import('../src/lib/core/lists/sequence.server');
  const list=await createList(other,{name:'Bounded playlist roots',playlist:true});
  try {
    for(const mediaId of [movie,season,movie])await addListItem(other,list.id,mediaId);
    await restartPlaylist(other,list.id);
    const source={kind:'playlist' as const,id:list.id};
    const roots=(await getList(other,list.id)).items.map(item=>item.entryId);
    const full=await sequenceEntries(other,source);
    const selected=await sequenceEntries(other,source,getDb(),roots.slice(1));
    expect(selected).toEqual(full.filter(entry=>roots.slice(1).some(root=>entry.entryId===root||entry.entryId.startsWith(root+'/'))));
    expect(selected.map(entry=>entry.mediaId)).toEqual([ep1,ep2,movie]);
    expect((await nextSequenceEntries(other,[source])).get(`playlist:${list.id}`)).toEqual(nextSequenceEntry(full) ?? undefined);
    await expect(nextSequenceEntries(owner,[source])).rejects.toThrow('not found');
  } finally {await deleteListWithExports(other,list.id);}
});

run('collection summary query count stays constant as a card page gains roots', async () => {
  const { sequenceSummaries } = await import('../src/lib/core/lists/sequence.server');
  const roots=await getDb().insert(s.media).values(Array.from({length:12},(_,i)=>({kind:'collection' as const,title:`Batched summary ${i}`}))).returning({id:s.media.id});
  try {
    await getDb().insert(s.mediaRelationships).values(roots.map(root=>({parentId:root.id,childId:movie,kind:'collection' as const})));
    // Only this disposable suite's ORM session is instrumented; no timing threshold or production logger changes.
    const session=(getDb() as unknown as {session:{logger:{logQuery:(query:string,params:unknown[])=>void}}}).session;
    const saved=session.logger;
    const counts:number[]=[];
    try {
      for(const size of [1,12]){
        let count=0;session.logger={logQuery:()=>{count++;}};
        const summaries=await sequenceSummaries(owner,roots.slice(0,size).map(root=>({kind:'collection',id:root.id})));
        expect(summaries.size).toBe(size);
        expect([...summaries.values()].every(summary=>summary.total===1)).toBe(true);
        counts.push(count);
      }
    } finally {session.logger=saved;}
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[1]).toBe(counts[0]);
  } finally {await getDb().delete(s.media).where(inArray(s.media.id,roots.map(root=>root.id)));}
});
