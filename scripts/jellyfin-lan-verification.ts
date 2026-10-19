// Actual connected catalogue only. Playback mutations require an owned DB restore.
import assert from 'node:assert/strict';
import { getSql, closeDb } from '$lib/server/db';
import { configureInstance, getInstance, instanceFetchConfig, instanceServerUrl, listProviders } from '$lib/providers/instances.server';
import { getJellyfin } from '$lib/providers/jellyfin/connection.server';
import { jellyfinAuthorization } from '$lib/providers/jellyfin/adapter.server';
import { decryptCredential } from '$lib/server/security/credentials';
import { secureProviderFetch } from '$lib/server/security/provider-fetch';
import { prepareReading, closeReading, readingDeliverySource } from '$lib/reading/sessions.server';
import { startPlayback, streamPlayback } from '$lib/playback/service.server';
import { planPlayback } from '$lib/playback/planning';
import { playbackLimits, sharedAllocation } from '$lib/sharing/policy';
import { getConfig } from '$lib/server/config';
const output = process.env.COAST_READING_AUDIT_OUTPUT, mode = process.env.COAST_JELLYFIN_LAN_MODE ?? 'verify';
const lanUrl = process.env.COAST_JELLYFIN_LAN_URL;
assert(output && lanUrl && ['verify', 'configure-dev', 'read-only'].includes(mode));
const sql = getSql(), report: any = { boundary: 'Actual admin, catalogue and live Jellyfin. No generated media. Owned restore for playback/settings-negative checks; explicit normal-dev LAN configuration only in configure-dev mode.', cases: [], mode };
const pass = (name: string) => report.cases.push({ name, status: 'passed' });
const originalFetch = globalThis.fetch;
const requests: {
    origin: string;
    path: string;
}[] = [];
const sessions: string[] = [];
let admin: any;
try {
    const [database] = await sql `select current_database() as name`;
    assert(mode !== 'verify' || database.name.startsWith('coast_reading_audit_'));
    const [user] = await sql `select id from users where username='admin' and role='admin' and not disabled`;
    assert(user);
    admin = user;
    const [row] = await sql `select i.id,c.id as connection_id from provider_instances i join provider_connections c on c.instance_id=i.id where i.provider='jellyfin' and i.enabled and c.user_id=${admin.id} and c.status='connected' order by i.id limit 1`;
    assert(row);
    const before = await getInstance(row.id, 'jellyfin');
    globalThis.fetch = Object.assign(async (input: any, init?: any) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        requests.push({ origin: url.origin, path: url.pathname });
        return originalFetch(input, init);
    }, originalFetch);
    if (mode !== 'read-only') {
        if (mode === 'configure-dev') {
            const backup = process.env.COAST_JELLYFIN_LAN_CHECKPOINT;
            assert(backup, 'A private settings checkpoint is required for normal dev.');
            await Bun.write(backup, JSON.stringify({ id: before.id, baseUrl: before.baseUrl, serverIdentity: before.serverIdentity, settings: before.settings }));
            await import('node:fs/promises').then(fs => fs.chmod(backup, 0o600));
        }
        await configureInstance(admin.id, { id: before.id, provider: 'jellyfin', name: before.name, baseUrl: before.baseUrl, lanUrl, allowPrivateNetwork: true });
    }
    const after = await getInstance(row.id, 'jellyfin');
    assert.equal(after.baseUrl, before.baseUrl);
    assert.equal(after.serverIdentity, before.serverIdentity);
    assert.equal(instanceServerUrl(after), lanUrl);
    pass('existing pinned identity verifies LAN directly; public URL, instance and account identity remain intact');
    assert.equal((await listProviders(admin.id)).find(p => p.id === row.id)?.lanUrl, undefined);
    assert.equal((await listProviders(admin.id, true)).find(p => p.id === row.id)?.lanUrl, lanUrl);
    pass('LAN address is exposed only in administrator integration settings');
    const { adapter, connection, instance } = await getJellyfin(admin.id, row.connection_id);
    const identity = await adapter.identity(instance.serverIdentity!);
    assert.equal(identity.id, instance.serverIdentity);
    const library = await adapter.library(connection.externalUserId!);
    assert(library.items.length);
    await adapter.sessions(connection.externalUserId!);
    await adapter.activeStreams();
    await adapter.musicLibrary(connection.externalUserId!, { limit: 1 });
    const books = await adapter.readingPage(connection.externalUserId!);
    assert(books.items.length);
    const [book] = await sql `select r.id from reading_works r join availability a on a.media_id=r.id where a.user_id=${admin.id} and a.connection_id=${connection.id} and a.state='available' and r.kind='comic' order by r.id limit 1`;
    assert(book);
    const reading = await prepareReading(admin.id, book.id, { source: 'linked' });
    sessions.push(reading.id);
    const delivery = await readingDeliverySource(admin.id, reading.id, new AbortController().signal);
    assert(delivery.key);
    const [readingRow] = await sql `select external_id from reading_sessions where id=${reading.id}`;
    const token = JSON.parse(await decryptCredential(connection.credentials!)).accessToken;
    const config = await instanceFetchConfig(instance);
    const auth = { Authorization: jellyfinAuthorization(admin.id, token) };
    const download = await secureProviderFetch(config, `/Items/${readingRow.external_id}/Download`, { headers: { ...auth, Range: 'bytes=0-0' } }, { stream: true });
    assert.equal(download.status, 206);
    assert.equal((await download.arrayBuffer()).byteLength, 1);
    const image = await secureProviderFetch(config, `/Items/${readingRow.external_id}/Images/Primary?maxWidth=64`, { headers: auth });
    assert.equal(image.status, 200);
    assert((await image.arrayBuffer()).byteLength > 0);
    pass('live identity, library/sync, music, reading, sessions/admin streams, image and original-file range use the shared LAN transport');
    const [video] = await sql `select a.media_id,p.external_id from availability a join provider_items p on p.id=a.provider_item_id join media m on m.id=a.media_id where a.user_id=${admin.id} and a.connection_id=${connection.id} and a.state='available' and m.kind in ('movie','episode') and a.bitrate>2000000 order by a.bitrate desc limit 1`;
    assert(video, 'Actual high-bitrate video required');
    const browser = { containers: ['mp4', 'm4v', 'webm'], videoCodecs: ['h264'], audioCodecs: ['aac', 'mp3'], nativeHls: false, hlsJs: true, maxBitrate: 1000000 };
    const info = await adapter.playbackInfo(video.external_id, connection.externalUserId!, browser, 1000000);
    const policy = await getConfig();
    const personal = playbackLimits(policy.maxBitrateMbps, {}).personal;
    const plan = planPlayback(info.sources, browser, { delivery: 'relay-only', maxBitrate: personal, allowTranscoding: true });
    assert.equal(plan.maxBitrate, 1000000);
    assert.equal(plan.mode, 'transcode');
    const allocated = sharedAllocation(playbackLimits(policy.maxBitrateMbps, { sharedBitrateMbps: 2 }).shared, 2);
    const shared = planPlayback(info.sources, browser, { delivery: 'relay-only', maxBitrate: allocated.bitrate, allowTranscoding: true });
    assert(shared.maxBitrate <= allocated.bitrate && shared.maxBitrate <= browser.maxBitrate);
    pass('actual high-bitrate video remains transcoded under browser/server/account/shared caps despite LAN upstream');
    const routed = [...requests];
    assert(routed.length > 10);
    assert(routed.every(r => r.origin === new URL(lanUrl).origin), 'Every verified upstream request must use LAN');
    if (mode === 'verify') {
        const playback = await startPlayback(admin.id, { mediaId: video.media_id, browser });
        const [stored] = await sql `select max_bitrate,stream_path,provider_device_id,provider_session_id from playback_sessions where id=${playback.id}`;
        assert.equal(stored.max_bitrate, 1000000);
        const response = await streamPlayback(admin.id, playback.id, new Request('http://remote-viewer.invalid/stream'));
        assert.equal(response.status, 200);
        const playlist = await response.text();
        assert(playlist.startsWith('#EXTM3U'));
        assert(!playlist.includes(lanUrl));
        assert(!playlist.includes(token));
        await adapter.stopEncoding(stored.provider_device_id, stored.provider_session_id);
        await sql `update playback_sessions set state='stopped' where id=${playback.id}`;
        assert(requests.every(r => r.origin === new URL(lanUrl).origin));
        pass('real remote-origin playback relay returns Coast-only HLS resource URLs at the stored 1Mbps ceiling');
        const [originalUser] = await sql `select settings from users where id=${admin.id}`;
        const [originalConfig] = await sql `select value from system_settings where key='coast'`;
        try {
            for (const test of [{ server: 3, personal: 2, expected: 2 }, { server: 1, personal: 2, expected: 1 }]) {
                await sql `update users set settings=settings||jsonb_build_object('personalBitrateMbps',${test.personal}::int) where id=${admin.id}`;
                await sql `update system_settings set value=value||jsonb_build_object('maxBitrateMbps',${test.server}::int) where key='coast'`;
                const capped = await startPlayback(admin.id, { mediaId: video.media_id, browser: { ...browser, maxBitrate: 50000000 } });
                const [row] = await sql `select max_bitrate from playback_sessions where id=${capped.id}`;
                assert.equal(row.max_bitrate, test.expected * 1000000);
                await sql `update playback_sessions set state='stopped' where id=${capped.id}`;
            }
        }
        finally {
            await sql `update users set settings=${originalUser.settings} where id=${admin.id}`;
            await sql `update system_settings set value=${originalConfig.value} where key='coast'`;
        }
        assert(requests.every(r => r.origin === new URL(lanUrl).origin));
        pass('actual playback independently enforces lower account and server ceilings with a 50Mbps-capable remote viewer');
        await assert.rejects(() => configureInstance(admin.id, { id: before.id, provider: 'jellyfin', name: before.name, baseUrl: before.baseUrl, lanUrl, allowPrivateNetwork: false }), /Approve private/);
        await assert.rejects(() => configureInstance(admin.id, { id: before.id, provider: 'jellyfin', name: before.name, baseUrl: before.baseUrl, lanUrl: 'http://user:secret@192.168.0.18:8096', allowPrivateNetwork: true }), /without credentials/);
        const originalIdentity = after.serverIdentity;
        await sql `update provider_instances set server_identity='00000000000000000000000000000000' where id=${after.id}`;
        try {
            await assert.rejects(() => configureInstance(admin.id, { id: before.id, provider: 'jellyfin', name: before.name, baseUrl: before.baseUrl, lanUrl, allowPrivateNetwork: true }), /identity changed/);
        }
        finally {
            await sql `update provider_instances set server_identity=${originalIdentity} where id=${after.id}`;
        }
        pass('configuration rejects unapproved private access, URL credentials and a different server identity');
    }
    report.upstreamCalls = routed.length;
    report.allJellyfinCallsUsedLan = true;
    report.paths = [...new Set(routed.map(r => r.path.replace(/[a-f0-9-]{32,36}/gi, '<id>')))];
    report.status = 'passed';
}
catch (cause) {
    report.status = 'failed';
    report.failure = String(cause);
    throw cause;
}
finally {
    globalThis.fetch = originalFetch;
    if (admin)
        for (const id of sessions)
            await closeReading(admin.id, id).catch(() => { });
    await closeDb();
    await Bun.write(output!, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
}
