import {requireFeature} from '#lib/server/features.js';
import { presentationPreferences } from '#lib/catalogue/overrides/presentation.server.js';
import { eq, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '#lib/server/db/index.js';
import { musicWorks } from '#lib/server/db/schema.js';
import { DomainError } from '#lib/core/errors.js';
import { PAGE_SIZE, pageNumberSchema, pagination } from '#lib/server/queries/pagination.js';
import { musicAlbumMembersSql } from './editions.server';

/** Track history, or the selected album edition's tracks, with owner filtering before paging. */
export async function musicHistory(userId: string, workId: string, requestedPage = 1) {
  v.parse(pageNumberSchema, requestedPage);
  await requireFeature(userId,'music');
  const db = getDb();
  const [work] = await db.select({ kind: musicWorks.kind }).from(musicWorks).where(eq(musicWorks.id, workId));
  if (!work) throw new DomainError('Music not found.', 404);
  const scope = work.kind === 'track' ? sql`l.track_id=${workId}`
    : sql`l.track_id in (select id from (${musicAlbumMembersSql(sql`${workId}::uuid`)}) members)`;
  const where = sql`l.user_id=${userId} and ${scope}`;
  const [count] = await db.execute<{ total: number }>(sql`select count(*)::int total from music_listens l where ${where}`);
  const { page, pages } = pagination(count.total, requestedPage);
  type Row = { id: string; workId: string; title: string; occurredAt: Date; dateKnown: boolean; source: string };
  const rows = await db.execute<Row>(sql`
    select l.id,m.id as "workId",m.title,l.occurred_at as "occurredAt",l.occurred_at_known as "dateKnown",l.source
    from music_listens l join music_works m on m.id=l.track_id where ${where}
    order by l.occurred_at desc,l.id desc limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`);
  const events=Array.from(rows) as Row[];
  const preferences=await presentationPreferences(userId,events.map(event=>event.workId));
  return { items: events.map(row => ({ ...row, title: preferences.get(row.workId)?.title ?? row.title, occurredAt: row.occurredAt.toISOString() })), page, pages, total: count.total };
}
