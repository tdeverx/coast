// Opt-in owned actual-data restore only. No worker and no normal-account mutations.
import assert from 'node:assert/strict';
import { getSql, closeDb } from '$lib/server/db';
import { prepareReading, closeReading, readingDeliverySource } from '$lib/reading/sessions.server';
import { readingManifest, readingPage } from '$lib/reading/delivery.server';
import { readingCache, readingLease, stopReadingCache, initializeReadingCache } from '$lib/reading/cache.server';
import { secureProviderFetch } from '$lib/server/security/provider-fetch';
import { instanceFetchConfig } from '$lib/providers/instances.server';
import { decryptCredential } from '$lib/server/security/credentials';
import { jellyfinAuthorization } from '$lib/providers/jellyfin/adapter.server';
import { getJellyfin } from '$lib/providers/jellyfin/connection.server';
import { ComicDecoder } from '$lib/reading/reader/archive-decoder';
import { createRoom, joinRoom, commandRoom, leaveRoom } from '$lib/playback/synced/service.server';
const manifest = process.env.COAST_READING_ACTUAL_MANIFEST, output = process.env.COAST_READING_AUDIT_OUTPUT;
assert(manifest && output && process.env.COAST_READING_CACHE_DIRECTORY, 'Supply private manifest/output and an isolated cache directory.');
const sql = getSql(), report: any = { boundary: 'Owned disposable restore, actual admin/guest connections and genuine live Jellyfin file. Controlled friendship/session/generation mutations only on copy; no worker or normal mutations.', cases: [] };
const pass = (name: string) => report.cases.push({ name, status: 'passed' });
const request = () => new Request('http://localhost/private-reading-verification');
const fails = async (code: number, run: () => Promise<unknown>) => {
    let failure: any;
    try {
        await run();
    }
    catch (cause) {
        failure = cause;
    }
    assert.equal(failure?.status, code);
};
async function layout(userId: string, id: string) {
    const response = await readingManifest(userId, id, request());
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    assert(!events.some(event => event.error), JSON.stringify(events.filter(event => event.error)));
    const document = events.at(-1).manifest;
    assert(document);
    assert.deepEqual(Object.keys(document).sort(), ['edition', 'format', 'pages', 'version']);
    assert(document.pages.every((page: any) => JSON.stringify(Object.keys(page).sort()) === JSON.stringify(['bytes', 'height', 'width'])));
    return document;
}
try {
    const [database] = await sql `select current_database() as name`;
    assert(database.name.startsWith('coast_reading_audit_'), 'Use only an owned actual-data restore.');
    const [admin] = await sql `select id,username,role,email,settings from users where username='admin' and role='admin' and not disabled`;
    const [input] = await Bun.file(manifest).json();
    const host = await prepareReading(admin.id, input.id, { source: 'linked' });
    assert(host.manifest);
    const started = performance.now(), document = await layout(admin.id, host.id);
    report.coldAuthenticatedManifestMs = performance.now() - started;
    const cache = await readingCache();
    assert.equal(cache.snapshot().entries, 1);
    assert.equal(cache.snapshot().leases, 1);
    pass('actual host preparation publishes only bounded presentation metadata');
    const source = await readingDeliverySource(admin.id, host.id, request().signal), lease = readingLease(admin.id, host.id);
    const oldRequest = await cache.acquire(lease, source), cancelOld = cache.claim(lease, oldRequest);
    const renewed = await cache.acquire(lease, source);
    cache.claim(lease, renewed);
    await cancelOld();
    assert.equal(cache.snapshot().leases, 1);
    assert.equal(renewed.controller.signal.aborted, false);
    pass('superseded request cleanup preserves the actual session renewed by a newer request');
    const [row] = await sql `select s.external_id,s.connection_id,c.instance_id from reading_sessions s join provider_connections c on c.id=s.connection_id where s.id=${host.id}`;
    const candidates = await sql `select u.id,c.id as connection_id from users u join provider_connections c on c.user_id=u.id where u.id<>${admin.id} and not u.disabled and c.instance_id=${row.instance_id} and c.status='connected' order by u.id`;
    let guest: typeof candidates[number] | undefined, denied: typeof candidates[number] | undefined;
    let deniedPolicies = 0;
    for (const candidate of candidates) {
        const { adapter, connection, instance } = await getJellyfin(candidate.id, candidate.connection_id);
        const permitted = await adapter.downloadAllowed(connection.externalUserId!, instance.serverIdentity);
        if (!permitted)
            deniedPolicies++;
        try {
            await adapter.readingItem(connection.externalUserId!, row.external_id);
        }
        catch {
            continue;
        }
        if (permitted)
            guest ??= candidate;
        else
            denied ??= candidate;
    }
    assert(guest, 'Actual independent guest connection required.');
    const guestSession = await prepareReading(guest.id, input.id, { source: 'jellyfin', connectionId: guest.connection_id, externalId: row.external_id });
    assert.equal(guestSession.edition, host.edition);
    const guestDocument = await layout(guest.id, guestSession.id);
    assert.deepEqual(guestDocument, document);
    assert.equal(cache.snapshot().entries, 1);
    assert.equal(cache.snapshot().leases, 2);
    pass('independently authorized actual party readers share the same prepared edition');
    const additional = [];
    try {
        // Eight admitted deliveries include the host; all use actual authorized sessions.
        for (let index = 0; index < 8; index++) {
            const session = await prepareReading(admin.id, input.id, { source: 'linked' });
            additional.push(session);
            if (index < 7)
                await layout(admin.id, session.id);
            else
                await fails(503, () => readingManifest(admin.id, session.id, request()));
        }
        assert.equal(cache.snapshot().leases, 9);
        await layout(admin.id, host.id);
        const independent = await readingPage(guest.id, guestSession.id, '0', request());
        await independent.arrayBuffer();
        pass('eight actual account deliveries reject a ninth while renewal and independent guest pages work');
        await closeReading(admin.id, additional[0].id);
        await layout(admin.id, additional[7].id);
        assert.equal(cache.snapshot().leases, 9);
        pass('releasing an actual account delivery admits its previously rejected session');
    }
    finally {
        for (const session of additional)
            await closeReading(admin.id, session.id);
    }
    assert.equal(cache.snapshot().leases, 2);
    await fails(410, () => readingPage(guest.id, host.id, '0', request()));
    assert.equal(cache.snapshot().leases, 2);
    pass('guest cannot borrow host session or release its lease');
    const baseline = await ComicDecoder.open(await Bun.file(input.file).arrayBuffer(), input.format);
    try {
        const original = baseline.read(baseline.entries[0].index);
        const response = await readingPage(guest.id, guestSession.id, '0', request());
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
        assert.equal(new Bun.CryptoHasher('sha256').update(await response.arrayBuffer()).digest('hex'), new Bun.CryptoHasher('sha256').update(original).digest('hex'));
    }
    finally {
        baseline.close();
    }
    pass('authenticated guest page preserves original bytes and private cache policy');
    await sql `insert into friendships(requested_by,user_a,user_b,state) values(${admin.id},least(${admin.id}::uuid,${guest.id}::uuid),greatest(${admin.id}::uuid,${guest.id}::uuid),'accepted') on conflict(user_a,user_b) do update set state='accepted'`;
    let room = await createRoom(admin.id, { readingSessionId: host.id });
    await sql `insert into synced_participants(room_id,user_id) values(${room.id},${guest.id}) on conflict do nothing`;
    room = await joinRoom(guest.id, room.id, { revision: room.revision, readingSessionId: guestSession.id });
    room = await commandRoom(admin.id, room.id, { revision: room.revision, action: 'location', location: { format: host.format, page: 4, total: document.pages.length } });
    assert.equal(room.reading?.page, 4);
    const [before] = await sql `select count(*)::int as count from reading_history where user_id in (${admin.id},${guest.id}) and work_id=${input.id}`;
    const page = await readingPage(guest.id, guestSession.id, '3', request());
    await page.arrayBuffer();
    const [after] = await sql `select count(*)::int as count from reading_history where user_id in (${admin.id},${guest.id}) and work_id=${input.id}`;
    assert.equal(after.count, before.count);
    pass('real reading party positions remain canonical and speculative page requests do not journal');
    await closeReading(admin.id, host.id);
    assert.equal(cache.snapshot().leases, 1);
    const remaining = await readingPage(guest.id, guestSession.id, '0', request());
    await remaining.arrayBuffer();
    await fails(410, () => readingPage(admin.id, host.id, '0', request()));
    pass('closing host preserves guest delivery while closed sessions lose access');
    const [generation] = await sql `select account_generation from provider_connections where id=${guest.connection_id}`;
    await sql `update provider_connections set account_generation=gen_random_uuid() where id=${guest.connection_id}`;
    await fails(410, () => readingPage(guest.id, guestSession.id, '0', request()));
    await sql `update provider_connections set account_generation=${generation.account_generation} where id=${guest.connection_id}`;
    assert.equal(cache.snapshot().leases, 0);
    pass('source generation withdrawal rejects cached pages and releases only the revoked reader');
    await closeReading(guest.id, guestSession.id);
    await leaveRoom(guest.id, room.id);
    const changed = await prepareReading(admin.id, input.id, { source: 'linked' });
    await layout(admin.id, changed.id);
    await sql `update reading_sessions set edition=repeat('0',64) where id=${changed.id}`;
    await fails(409, () => readingPage(admin.id, changed.id, '0', request()));
    assert.equal(cache.snapshot().leases, 0);
    pass('changed edition cannot reuse the prior manifest or pages');
    await closeReading(admin.id, changed.id);
    // Controlled scheduling, genuine actual archive: another authorized reader keeps
    // preparation alive after the waiting reader loses its session/account generation.
    for (const withdrawal of ['close', 'generation'] as const) {
        await stopReadingCache();
        await initializeReadingCache();
        const host = await prepareReading(admin.id, input.id, { source: 'linked' });
        const guestSession = await prepareReading(guest.id, input.id, { source: 'jellyfin', connectionId: guest.connection_id, externalId: row.external_id });
        const cache = await readingCache();
        const source = await readingDeliverySource(admin.id, host.id, request().signal);
        let allow!: () => void;
        const gate = new Promise<void>(resolve => allow = resolve);
        const entry = await cache.acquire(readingLease(admin.id, host.id), { ...source, open: async (signal) => {
                await gate;
                return source.open(signal);
            } });
        const waiting = readingPage(guest.id, guestSession.id, '0', request()).then(response => ({ response }), error => ({ error }));
        const deadline = Date.now() + 10000;
        while (cache.snapshot().leases !== 2 && Date.now() < deadline)
            await Bun.sleep(10);
        assert.equal(cache.snapshot().leases, 2, 'Actual guest request reached the shared preparation wait');
        const [generation] = await sql `select account_generation from provider_connections where id=${guest.connection_id}`;
        try {
            if (withdrawal === 'close')
                await closeReading(guest.id, guestSession.id);
            else
                await sql `update provider_connections set account_generation=gen_random_uuid() where id=${guest.connection_id}`;
            allow();
            const result = await waiting;
            if ('response' in result)
                await result.response.body?.cancel();
            assert('error' in result && result.error?.status === 410, 'Waiting request must reauthorize before publishing original page bytes');
            await entry.job;
            const remaining = await readingPage(admin.id, host.id, '0', request());
            assert.equal(remaining.status, 200);
            assert((await remaining.arrayBuffer()).byteLength > 0);
            pass(`actual ${withdrawal} withdrawal during shared preparation rejects waiting page while host remains authorized`);
        }
        finally {
            allow();
            await sql `update provider_connections set account_generation=${generation.account_generation} where id=${guest.connection_id}`;
            await closeReading(guest.id, guestSession.id);
            await closeReading(admin.id, host.id);
        }
    }
    if (denied) {
        await stopReadingCache();
        await initializeReadingCache();
        const permitted = await prepareReading(admin.id, input.id, { source: 'linked' });
        await layout(admin.id, permitted.id);
        const deniedSession = await prepareReading(denied.id, input.id, { source: 'jellyfin', connectionId: denied.connection_id, externalId: row.external_id });
        const deniedContext = await getJellyfin(denied.id, denied.connection_id);
        assert(await deniedContext.adapter.readingItem(deniedContext.connection.externalUserId!, row.external_id));
        const credentials = JSON.parse(await decryptCredential(deniedContext.connection.credentials!));
        const deniedDownload = await secureProviderFetch(await instanceFetchConfig(deniedContext.instance), `/Items/${row.external_id}/Download`, { headers: { Authorization: jellyfinAuthorization(denied.id, credentials.accessToken), Range: 'bytes=0-0' } }, { stream: true });
        await deniedDownload.body?.cancel();
        assert.equal(deniedDownload.status, 403, 'The real provider independently denies this account’s original download');
        const sharedCache = await readingCache(), beforeDenied = sharedCache.snapshot();
        await fails(403, () => readingPage(denied!.id, deniedSession.id, '0', request()));
        await fails(403, () => readingManifest(denied!.id, deniedSession.id, request()));
        assert.deepEqual(sharedCache.snapshot(), beforeDenied);
        const permittedPage = await readingPage(admin.id, permitted.id, '0', request());
        assert.equal(permittedPage.status, 200);
        await permittedPage.body?.cancel();
        await closeReading(denied.id, deniedSession.id);
        await closeReading(admin.id, permitted.id);
        pass('actual metadata-visible download-disabled account cannot borrow admin cached pages or manifest; allowed host remains authorized');
    }
    else {
        assert(deniedPolicies > 0, 'Actual download-disabled accounts required for policy acceptance.');
        report.absentCohorts = ['No connected actual account combines visible comic metadata with disabled downloads; the two disabled accounts have zero visible books. Natural warm-cache exploit replay is unavailable.'];
        pass('actual download-disabled token-owned policies are denied; absent metadata-visible negative cohort is explicit');
    }
    report.status = 'passed';
}
catch (cause) {
    report.status = 'failed';
    report.failure = String(cause);
    throw cause;
}
finally {
    await stopReadingCache();
    await closeDb();
    await Bun.write(output!, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
}
