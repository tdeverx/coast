// Opt-in actual-data integration checks. Private restore only; do not run a worker.
import { getSql, closeDb } from '$lib/server/db';
import { updateUserSettings, resetUserSettings } from '$lib/server/auth';
import { prepareReading, moveReading, closeReading } from '$lib/reading/sessions.server';
import { updateReading } from '$lib/core/reading/service.server';
import { readingHistoryData } from '$lib/reading/query.server';
import { presence } from '$lib/social/presence.server';
import { activityFeed } from '$lib/social/queries.server';
import { activeStreams } from '$lib/application/streams.server';
import { readingStreamCount } from '$lib/reading/streams.server';
import { createRoom, joinRoom, commandRoom, roomState, leaveRoom } from '$lib/playback/synced/service.server';
import { createShare } from '$lib/sharing/service.server';
import assert from 'node:assert/strict';
const output = process.env.COAST_READING_AUDIT_OUTPUT, manifest = process.env.COAST_READING_ACTUAL_MANIFEST;
assert(output && manifest, 'Supply private result and actual-file manifest paths');
const sql = getSql(), report: any = { boundary: 'Owned disposable restore of actual catalogue/admin/provider access. Controlled preference/state/party conditions; no fabricated users/media/provider replies. No worker or external notification delivery.', cases: [] };
const pass = (name: string) => report.cases.push({ name, status: 'passed' });
const fails = async (name: string, fn: () => Promise<unknown>, code: number) => {
    let cause: any;
    try {
        await fn();
    }
    catch (e) {
        cause = e;
    }
    assert.equal(cause?.status, code, name);
    pass(name);
};
try {
    const [db] = await sql `select current_database() as name`;
    assert(db.name.startsWith('coast_reading_audit_'), 'Use only an owned disposable actual-data restore');
    const [admin] = await sql `select id,username,role,email,settings from users where username='admin' and role='admin' and not disabled`;
    const [input] = await Bun.file(manifest).json();
    await updateUserSettings(admin, { sanitizeOddReadingPages: false });
    assert.equal((await sql `select settings from users where id=${admin.id}`)[0].settings.sanitizeOddReadingPages, false);
    await assert.rejects(() => updateUserSettings(admin, { sanitizeOddReadingPages: 'off' }));
    pass('preference rejects invalid type');
    await resetUserSettings(admin);
    assert.equal((await sql `select settings from users where id=${admin.id}`)[0].settings.sanitizeOddReadingPages, undefined);
    pass('preference persists false and reset inherits enabled default');
    const session = await prepareReading(admin.id, input.id, { source: 'linked' });
    const initial = await readingStreamCount(admin.id);
    assert(initial >= 1);
    assert((await presence(admin.id)).some(row => row.userId === admin.id && row.workId === input.id));
    pass('actual reading session appears in own user presence');
    const rows = await activeStreams(admin);
    assert(rows.streams.some(row => row.id === session.id && row.mediaType === 'Book' && row.card.id === input.id && row.endedAt === null));
    pass('actual reading session appears in bounded admin panel');
    await fails('admin panel rejects anonymous viewer', () => activeStreams(null), 401);
    const [previous] = await sql `select state from reading_progress where user_id=${admin.id} and work_id=${input.id}`;
    const state = previous?.state === 'paused' ? 'reading' : 'paused';
    await updateReading(admin.id, input.id, { state, page: 2, totalPages: input.totalPages });
    const events = await activityFeed(admin.id, { category: 'reading', workId: input.id });
    assert(events.items.some(row => JSON.stringify(row).includes(`reading-${state}`)));
    const history = await readingHistoryData(admin.id, input.id);
    assert(history.items.some(row => row.state === state));
    pass('reading state appears in shared Activity and owner journal');
    const [historyBefore] = await sql `select count(*)::int as n from reading_history where user_id=${admin.id} and work_id=${input.id}`;
    await moveReading(admin.id, session.id, { format: session.format, page: 3, total: input.totalPages });
    const [historyAfter] = await sql `select count(*)::int as n from reading_history where user_id=${admin.id} and work_id=${input.id}`;
    assert.equal(historyBefore.n, historyAfter.n);
    pass('ordinary page movement does not add Activity history');
    await sql `update reading_sessions set updated_at=now()-interval '3 minutes' where id=${session.id}`;
    assert(!(await activeStreams(admin)).streams.some(row => row.id === session.id));
    const staleHistory=(await activeStreams(admin,{view:'history'})).streams.find(row=>row.id===session.id);
    assert(staleHistory);
    assert.equal(staleHistory.endedAt,staleHistory.lastSeenAt);
    await sql `update reading_sessions set updated_at=now() where id=${session.id}`;
    assert(!(await activeStreams(admin,{view:'history'})).streams.some(row=>row.id===session.id));
    pass('stale heartbeat moves to History at last observation and a fresh heartbeat restores Now');
    const [generation]=await sql `select account_generation from reading_sessions where id=${session.id}`;
    await sql `update reading_sessions set account_generation=gen_random_uuid() where id=${session.id}`;
    assert(!(await activeStreams(admin)).streams.some(row=>row.id===session.id));
    assert((await activeStreams(admin,{view:'history'})).streams.some(row=>row.id===session.id));
    await sql `update reading_sessions set account_generation=${generation.account_generation} where id=${session.id}`;
    pass('withdrawn source generation moves reader into History');
    let room = await createRoom(admin.id, { readingSessionId: session.id });
    room = await commandRoom(admin.id, room.id, { revision: room.revision, action: 'location', location: { format: session.format, page: 4, total: input.totalPages } });
    assert.equal(room.reading?.page, 4);
    await fails('stale party revision rejected', () => commandRoom(admin.id, room.id, { revision: room.revision - 1, action: 'location', location: { format: session.format, page: 5, total: input.totalPages } }), 409);
    await fails('reading party rejects playback time seek', () => commandRoom(admin.id, room.id, { revision: room.revision, action: 'seek', positionSeconds: 3 }), 400);
    pass('actual reading party host accepts canonical page location');
    const guests = await sql `select distinct u.id from users u join availability a on a.user_id=u.id join provider_connections c on c.id=a.connection_id where u.id<>${admin.id} and not u.disabled and a.media_id=${input.id} and a.state in ('available','unknown') and c.status='connected'`;
    report.actualGuestCandidates = guests.length;
    if (guests.length) {
        const guest = guests[0];
        let guestSession;
        try {
            guestSession = await prepareReading(guest.id, input.id, { source: 'linked' });
        }
        catch (cause) {
            assert.equal((cause as any).status, 409);
            const [mapping] = await sql `select s.external_id,c.id as connection_id from reading_sessions s join provider_connections host on host.id=s.connection_id join provider_connections c on c.instance_id=host.instance_id and c.user_id=${guest.id} and c.status='connected' where s.id=${session.id}`;
            assert(mapping, 'Actual guest connection on the same source');
            guestSession = await prepareReading(guest.id, input.id, { source: 'jellyfin', connectionId: mapping.connection_id, externalId: mapping.external_id });
            pass('stale guest mapping refreshed on copy through live exact-source verification');
        }
        if (guestSession.edition === session.edition) {
            await sql `insert into friendships(requested_by,user_a,user_b,state) values(${admin.id},least(${admin.id}::uuid,${guest.id}::uuid),greatest(${admin.id}::uuid,${guest.id}::uuid),'accepted') on conflict(user_a,user_b) do update set state='accepted'`;
            await sql `insert into synced_participants(room_id,user_id) values(${room.id},${guest.id}) on conflict do nothing`;
            await fails('guest must supply their own reading session', () => joinRoom(guest.id, room.id, { revision: room.revision }), 409);
            await fails('host session cannot grant guest file access', () => joinRoom(guest.id, room.id, { revision: room.revision, readingSessionId: session.id }), 410);
            room = await joinRoom(guest.id, room.id, { revision: room.revision, readingSessionId: guestSession.id });
            await fails('follower page commands rejected', () => commandRoom(guest.id, room.id, { revision: room.revision, action: 'location', location: { format: session.format, page: 5, total: input.totalPages } }), 403);
            await leaveRoom(guest.id, room.id);
            pass('actual independently authorized guest joins matching edition and leaves');
        }
        else
            report.cases.push({ name: 'guest matching edition', status: 'not-present' });
        await closeReading(guest.id, guestSession.id);
    }
    else
        report.cases.push({ name: 'actual independent guest access', status: 'not-present' });
    const [connection] = await sql `select connection_id from reading_sessions where id=${session.id}`;
    await sql `update system_settings set value=value||'{"allowPlaybackSharing":true,"allowTranscoding":true}'::jsonb where key='coast'`;
    await fails('public playback sharing refuses comic sources', () => createShare(admin, { workId: input.id, connectionId: connection.connection_id }), 403);
    // Controlled duplicate sessions use the same verified actual source and
    // sub-millisecond creation times to exercise the shared cursor boundary.
    const cursorRows = await sql `insert into reading_sessions(user_id,work_id,format,edition,connection_id,account_generation,external_id,location,expires_at,created_at,updated_at)
      select user_id,work_id,format,edition,connection_id,account_generation,external_id,location,expires_at,
        date_trunc('milliseconds',now())+n*interval '1 microsecond',now()
      from reading_sessions cross join generate_series(1,22) n where id=${session.id} returning id`;
    const pageOne = await activeStreams(admin), pageTwo = await activeStreams(admin, { before: pageOne.nextCursor });
    assert(pageOne.nextCursor);
    assert(!pageOne.streams.some(row => pageTwo.streams.some(other => other.id === row.id)));
    const seen = new Set([...pageOne.streams, ...pageTwo.streams].map(row => row.id));
    assert(cursorRows.every(row => seen.has(row.id)));
    await sql `delete from reading_sessions where id in ${sql(cursorRows.map(row => row.id))}`;
    pass('admin reading cursor preserves sub-millisecond sessions without gaps or duplicates');
    await closeReading(admin.id, session.id);
    assert(!(await activeStreams(admin)).streams.some(row => row.id === session.id));
    assert((await activeStreams(admin, { view: 'history' })).streams.some(row => row.id === session.id));
    pass('closed reader leaves Now and appears in History');
    assert((await roomState(admin.id, room.id)).participants.find(row => row.userId === admin.id)?.joined === false);
    pass('closed source withdraws party participation');
    report.status = 'passed';
}
catch (cause) {
    report.status = 'failed';
    report.failure = String(cause);
    throw cause;
}
finally {
    await closeDb();
    await Bun.write(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
}
