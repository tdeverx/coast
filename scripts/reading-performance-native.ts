// Opt-in mutation checks: real admin/catalogue, disposable actual-data copy only.
// Run with the normal encrypted-data directory, never a live database. No worker
// is started, so queued clone effects cannot be delivered to external services.
import { getSql, closeDb } from '#lib/server/db/index.js';
import { prepareReading, closeReading, moveReading } from '#lib/reading/sessions.server.js';
import { readingDetails } from '#lib/reading/query.server.js';
import { getJellyfin } from '#lib/providers/jellyfin/connection.server.js';
import assert from 'node:assert/strict';
const output = process.env.COAST_READING_AUDIT_OUTPUT;
assert(output, 'Supply a private result path');
const sql = getSql(), report: any = { startedAt: new Date().toISOString(), boundary: 'Disposable copy of the refreshed actual catalogue, existing admin, actual Jellyfin responses. No invented user, catalogue or provider DTO.', cases: [] };
const sessions: string[] = [];
try {
    const [identity] = await sql `select current_database() as name`;
    assert(identity.name.startsWith('coast_reading_audit_'), 'Run mutation checks only on an owned disposable actual-data copy');
    const manifest = process.env.COAST_READING_ACTUAL_MANIFEST;
    assert(manifest, 'Supply the verified actual-file manifest for the bookmark case');
    const [input] = await Bun.file(manifest).json();
    assert(Number.isInteger(input.totalPages) && input.totalPages >= 2);
    const [admin] = await sql `select id from users where username='admin' and role='admin' and not disabled`;
    const connections = await sql `select c.id from provider_connections c join provider_instances i on i.id=c.instance_id where c.user_id=${admin.id} and c.status='connected' and i.enabled and i.provider='jellyfin'`;
    const live = new Set<string>();
    for (const c of connections) {
        const context = await getJellyfin(admin.id, c.id);
        let offset = 0;
        do {
            const page = await context.adapter.readingPage(context.connection.externalUserId!, offset);
            for (const item of page.items)
                live.add(item.Id);
            if (page.nextOffset === null)
                break;
            offset = page.nextOffset;
        } while (offset <= 60000);
    }
    const works = await sql `select distinct r.id,r.kind from reading_works r join availability a on a.media_id=r.id where a.user_id=${admin.id} and a.state='available' order by r.id`;
    for (const work of works) {
        const start = performance.now();
        try {
            const s = await prepareReading(admin.id, work.id, { source: 'linked' });
            sessions.push(s.id);
            assert.equal(s.workId, work.id);
            assert.equal(s.kind, work.kind);
            assert.equal(s.source, 'jellyfin');
            const [row] = await sql `select external_id from reading_sessions where id=${s.id}`;
            assert(live.has(row.external_id.replaceAll('-', '')));
            report.cases.push({ name: 'actual-default-open', kind: work.kind, ms: performance.now() - start, format: s.format, status: 'passed' });
            await closeReading(admin.id, s.id);
        }
        catch (cause) {
            report.cases.push({ name: 'actual-default-open', kind: work.kind, status: 'failed', statusCode: (cause as any).status, message: String(cause) });
        }
    }
    const sourceRows = await sql `select a.id as availability_id,a.verified_at,e.work_id,e.format,e.external_id,e.metadata->>'version' as edition,c.id as connection_id,c.account_generation from work_editions e join provider_connections c on c.instance_id=e.instance_id and c.user_id=${admin.id} join provider_items p on p.instance_id=e.instance_id and p.media_id=e.work_id and replace(lower(p.external_id),'-','')=replace(lower(e.external_id),'-','') join availability a on a.provider_item_id=p.id and a.connection_id=c.id where a.state in ('available','unknown')`;
    const stale = sourceRows.find(row => !live.has(row.external_id.replaceAll('-', '')) && sourceRows.some(other => other.work_id === row.work_id && live.has(other.external_id.replaceAll('-', ''))));
    if (stale) {
        await sql `update availability set state='available' where id=${stale.availability_id}`;
        // This old-edition bookmark is controlled state, not a claim about the missing file's page count.
        const [preferred] = await sql `insert into reading_sessions(user_id,work_id,format,edition,connection_id,account_generation,external_id,location,expires_at) values(${admin.id},${stale.work_id},${stale.format},${stale.edition},${stale.connection_id},${stale.account_generation},${stale.external_id},${{ format: stale.format, page: 2, total: 24 }}::jsonb,now()+interval '1 day') returning id`;
        sessions.push(preferred.id);
        const s = await prepareReading(admin.id, stale.work_id, { source: 'linked' });
        sessions.push(s.id);
        assert.notEqual(s.edition, stale.edition);
        assert.equal(s.location, null);
        const [state] = await sql `select state from availability where id=${stale.availability_id}`;
        assert.equal(state.state, 'unknown');
        report.cases.push({ name: 'controlled-bookmark-on-natural-missing-source-falls-through-without-copy', status: 'passed' });
        await closeReading(admin.id, s.id);
    }
    else
        report.cases.push({ name: 'natural-missing-source', status: 'not-present' });
    const work = works.find(work => work.id === input.id);
    assert(work, 'The admitted actual document must exist in this copy');
    const first = await prepareReading(admin.id, work.id, { source: 'linked' });
    sessions.push(first.id);
    await moveReading(admin.id, first.id, { format: first.format, page: 2, total: input.totalPages });
    await closeReading(admin.id, first.id);
    const second = await prepareReading(admin.id, work.id, { source: 'linked' });
    sessions.push(second.id);
    assert.equal(second.edition, first.edition);
    assert.deepEqual(second.location, { format: first.format, page: 2, total: input.totalPages });
    await closeReading(admin.id, second.id);
    report.cases.push({ name: 'same-edition-bookmark-resume', status: 'passed' });
    const expectFailure = async (name: string, code: number, fn: () => Promise<unknown>) => { let caught: any; try {
        await fn();
    }
    catch (cause) {
        caught = cause;
    } assert.equal(caught?.status, code, name); report.cases.push({ name, status: 'passed', statusCode: code }); };
    await sql `update users set disabled=true where id=${admin.id}`;
    try {
        await expectFailure('disabled-real-admin', 401, () => prepareReading(admin.id, work.id, { source: 'linked' }));
    }
    finally {
        await sql `update users set disabled=false where id=${admin.id}`;
    }
    const [settings] = await sql `select value from system_settings where key='coast'`;
    await sql `update system_settings set value=jsonb_set(value,'{features}',coalesce(value->'features','{}'::jsonb)||'{"reader":false}'::jsonb) where key='coast'`;
    try {
        await expectFailure('reader-feature-disabled', 403, () => prepareReading(admin.id, work.id, { source: 'linked' }));
    }
    finally {
        await sql `update system_settings set value=${settings.value}::jsonb where key='coast'`;
    }
    const before = await sql `select count(*)::int as n from reading_sessions`;
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(() => prepareReading(admin.id, work.id, { source: 'linked' }, abort.signal), { name: 'AbortError' });
    const after = await sql `select count(*)::int as n from reading_sessions`;
    assert.equal(after[0].n, before[0].n);
    report.cases.push({ name: 'pre-aborted-open-creates-no-session', status: 'passed' });
    await sql `update provider_connections set status='disconnected' where user_id=${admin.id} and id in ${sql(connections.map(c => c.id))}`;
    await expectFailure('disconnected-owner-cannot-select-another-users-link', 409, () => prepareReading(admin.id, work.id, { source: 'linked' }));
    assert.equal((await readingDetails(admin.id, work.id)).item.available, false);
    report.cases.push({ name: 'unavailable-detail-has-no-read-availability', status: 'passed' });
    report.liveFiles = live.size;
    report.catalogueWorks = works.length;
    report.status = report.cases.every(c => c.status !== 'failed') ? 'passed' : 'failed';
    assert.equal(report.status, 'passed');
}
catch (cause) {
    report.status = 'failed';
    report.failure = String(cause);
    throw cause;
}
finally {
    for (const id of sessions)
        await sql `update reading_sessions set closed_at=coalesce(closed_at,now()) where id=${id}`;
    await closeDb();
    await Bun.write(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
}
