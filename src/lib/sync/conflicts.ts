import { resolveListConflict, localListValue } from './list-values';
import { applySyncValue, localSyncValue, valueCategories, type ValueCategory } from './values';
import { enqueueSyncValueInTransaction, enqueueInTransaction } from './changes';
import * as v from 'valibot';
import { and, eq, isNull, desc, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
  trackingEvents,
  media,
  syncValues,
  providerConnections,
  providerInstances,
  syncListValues,
  lists,
  mediaRequests,
} from '$lib/server/db/schema';
import { trackInTransaction } from '$lib/core/tracking/service';
import { DomainError } from '$lib/core/errors';

export async function getPendingConflicts(userId: string) {
  const rows = await getDb()
    .select({ event: trackingEvents, title: media.title, kind: media.kind })
    .from(trackingEvents)
    .innerJoin(media, eq(media.id, trackingEvents.mediaId))
    .where(
      and(
        eq(trackingEvents.userId, userId),
        eq(trackingEvents.applied, false),
        isNull(trackingEvents.reviewedAt)
      )
    )
    .orderBy(desc(trackingEvents.createdAt))
    .limit(100);
  const providerConflicts = await getDb()
    .select({
      entry: syncValues,
      title: media.title,
      kind: media.kind,
      source: providerInstances.name,
    })
    .from(syncValues)
    .innerJoin(providerConnections, eq(providerConnections.id, syncValues.connectionId))
    .innerJoin(providerInstances, eq(providerInstances.id, providerConnections.instanceId))
    .innerJoin(media, eq(media.id, syncValues.mediaId))
    .where(and(eq(providerConnections.userId, userId), eq(syncValues.conflict, true)))
    .orderBy(desc(syncValues.updatedAt))
    .limit(100);
  const listConflicts = await getDb()
    .select({ entry: syncListValues, title: lists.name, source: providerInstances.name })
    .from(syncListValues)
    .innerJoin(lists, eq(lists.id, syncListValues.listId))
    .innerJoin(providerConnections, eq(providerConnections.id, syncListValues.connectionId))
    .innerJoin(providerInstances, eq(providerInstances.id, providerConnections.instanceId))
    .where(
      and(
        eq(lists.userId, userId),
        eq(providerConnections.userId, userId),
        eq(syncListValues.conflict, true)
      )
    );
  const localValues = await getDb().transaction(async (tx) => {
    const values = new Map<string, Record<string, unknown>>();
    for (const { entry } of providerConflicts)
      values.set(
        entry.id,
        valueCategories.includes(entry.category as ValueCategory)
          ? await localSyncValue(tx, userId, entry.mediaId, entry.category as ValueCategory)
          : (entry.agreed ?? {})
      );
    for (const { entry } of listConflicts)
      values.set(entry.id, await localListValue(tx, userId, entry.listId));
    return values;
  });
  return [
    ...listConflicts.map(({ entry, title, source }) => ({
      id: entry.id,
      mediaId: '',
      title,
      kind: 'list',
      source,
      action: 'list',
      value: null,
      positionSeconds: null,
      durationSeconds: null,
      occurredAt: entry.updatedAt,
      reason:
        'List names, membership or order differ. Choose which service should replace the others.',
      remoteValue: entry.remote,
      localValue: localValues.get(entry.id),
    })),
    ...providerConflicts.map(({ entry, title, kind, source }) => ({
      id: entry.id,
      mediaId: entry.mediaId,
      title,
      kind,
      source,
      action: entry.category.startsWith('request:') ? 'request' : entry.category,
      value: typeof entry.remote.value === 'boolean' ? entry.remote.value : null,
      positionSeconds:
        typeof entry.remote.positionSeconds === 'number' ? entry.remote.positionSeconds : null,
      durationSeconds:
        typeof entry.remote.durationSeconds === 'number' ? entry.remote.durationSeconds : null,
      occurredAt: entry.updatedAt,
      reason:
        'Coast and this service have different changes. Choose the value to use across connected services.',
      remoteValue: entry.remote,
      localValue: localValues.get(entry.id),
    })),
    ...rows.map(({ event, title, kind }) => ({
      id: event.id,
      mediaId: event.mediaId,
      title,
      kind,
      source: event.source,
      action: event.action,
      value: event.value,
      positionSeconds: event.positionSeconds,
      durationSeconds: event.durationSeconds,
      occurredAt: event.occurredAt,
      reason: event.reviewReason,
      remoteValue: undefined,
      localValue: undefined,
    })),
  ];
}
/** Accept appends an acknowledged event; ignore preserves Coast and the original evidence. */
export async function resolveConflict(
  userId: string,
  eventId: string,
  decision: 'accepted' | 'ignored'
) {
  v.parse(v.pipe(v.string(), v.uuid()), eventId);
  v.parse(v.picklist(['accepted', 'ignored']), decision);
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`);
    const [listConflict] = await tx
      .select({ entry: syncListValues })
      .from(syncListValues)
      .innerJoin(lists, eq(lists.id, syncListValues.listId))
      .where(and(eq(syncListValues.id, eventId), eq(lists.userId, userId)));
    if (listConflict) {
      await resolveListConflict(tx, userId, listConflict.entry, decision === 'accepted');
      return { decision, alreadyReviewed: !listConflict.entry.conflict };
    }
    const [providerConflict] = await tx
      .select({ entry: syncValues })
      .from(syncValues)
      .innerJoin(providerConnections, eq(providerConnections.id, syncValues.connectionId))
      .where(and(eq(syncValues.id, eventId), eq(providerConnections.userId, userId)));
    if (providerConflict) {
      const entry = providerConflict.entry;
      if (!entry.conflict) return { decision, alreadyReviewed: true };
      if (entry.category.startsWith('request:')) {
        const requestId = entry.category.slice('request:'.length);
        const [request] = await tx
          .select()
          .from(mediaRequests)
          .where(and(eq(mediaRequests.id, requestId), eq(mediaRequests.userId, userId)));
        if (!request) throw new DomainError('Request not found.');
        if (decision === 'accepted') {
          await tx
            .update(mediaRequests)
            .set({ state: entry.remote.value as typeof request.state, updatedAt: new Date() })
            .where(eq(mediaRequests.id, requestId));
        } else {
          const desired = entry.agreed?.value;
          const action =
            desired === 'approved'
              ? 'approve'
              : desired === 'declined'
                ? 'decline'
                : desired === 'cancelled'
                  ? 'cancel'
                  : null;
          if (!action) throw new DomainError('This request state cannot be written to Seerr.');
          await enqueueInTransaction(tx, {
            userId,
            connectionId: entry.connectionId,
            kind: 'seerr.manage',
            payload: { requestId, action, resolved: true },
          });
        }
        await tx
          .update(syncValues)
          .set({ conflict: false, updatedAt: new Date() })
          .where(eq(syncValues.id, entry.id));
        return { decision, alreadyReviewed: false };
      }
      if (!valueCategories.includes(entry.category as ValueCategory))
        throw new DomainError('Unsupported conflict category.');
      const category = entry.category as ValueCategory;
      const winning =
        decision === 'accepted'
          ? entry.remote
          : await localSyncValue(tx, userId, entry.mediaId, category);
      await applySyncValue(tx, userId, entry.mediaId, category, winning, 'coast-review');
      const connections = tx
        .select({ id: providerConnections.id })
        .from(providerConnections)
        .where(eq(providerConnections.userId, userId));
      await tx
        .update(syncValues)
        .set({ conflict: false, agreed: winning, updatedAt: new Date() })
        .where(
          and(
            eq(syncValues.mediaId, entry.mediaId),
            eq(syncValues.category, category),
            sql`${syncValues.connectionId} in (${connections})`
          )
        );
      await enqueueSyncValueInTransaction(tx, userId, entry.mediaId, category, winning);
      return { decision, alreadyReviewed: false };
    }
    const [event] = await tx
      .select()
      .from(trackingEvents)
      .where(and(eq(trackingEvents.id, eventId), eq(trackingEvents.userId, userId)));
    if (!event) throw new DomainError('This imported change was not found.', 404, 'not_found');
    if (event.applied) throw new DomainError('This change has already been applied.');
    if (event.reviewedAt) return { decision: event.reviewDecision, alreadyReviewed: true };
    let result;
    if (decision === 'accepted')
      result = await trackInTransaction(tx, userId, {
        mediaId: event.mediaId,
        action: event.action,
        value: event.value ?? undefined,
        positionSeconds: event.positionSeconds ?? undefined,
        durationSeconds: event.durationSeconds ?? undefined,
        editionId: event.editionId ?? undefined,
        rewatch: event.rewatch,
        source: 'coast-review',
        sourceEventId: `review:${event.id}`,
        occurredAt: event.occurredAt.toISOString(),
        occurredAtKnown: event.occurredAtKnown,
        acknowledged: true,
      });
    await tx
      .update(trackingEvents)
      .set({ reviewedAt: new Date(), reviewDecision: decision })
      .where(eq(trackingEvents.id, eventId));
    const category =
      event.action === 'watch' || event.action === 'unwatch'
        ? 'history'
        : event.action === 'collect'
          ? 'collection'
          : event.action;
    if (valueCategories.includes(category as ValueCategory)) {
      const value = await localSyncValue(tx, userId, event.mediaId, category as ValueCategory);
      await enqueueSyncValueInTransaction(
        tx,
        userId,
        event.mediaId,
        category as ValueCategory,
        value
      );
    }
    return { decision, alreadyReviewed: false, state: result?.state };
  });
}
