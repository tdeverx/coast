/** Native resume/lease acceptance on a marked disposable real-data copy.
 * Allows at most eight genuine GETs to the account’s approved effective Jellyfin
 * transport. All state/feature/job changes stay in the disposable database. */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { getSql, closeDb } from '../src/lib/server/db';
import { getFeatureConfig } from '../src/lib/server/features';
import { instanceServerUrl } from '../src/lib/providers/instances.server';
import { getJellyfin } from '../src/lib/providers/jellyfin/connection.server';
import { syncJellyfinUser } from '../src/lib/sync/jellyfin.server';
import { jobExecution, JobYield } from '../src/lib/server/queue/execution';
const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
const name = url.pathname.slice(1), marker = process.env.COAST_AUDIT_COPY_MARKER;
if (!/^coast_audit_followup_[a-f0-9]{32}$/.test(name) || marker !== `coast-performance-followup:${name.slice('coast_audit_followup_'.length)}` || process.env.COAST_AUDIT_IDENTITY_READ !== '1')
    throw Error('A marked disposable actual-data copy and explicit GET-only provider-read opt-in are required.');
const copy = { marker };
const client = getSql(), report: any = { boundary: 'Real retained admin/account/catalogue; controlled finalization resume on marked copy. Only GETs to its actual Jellyfin origin are permitted, at most eight; no fabricated upstream replies or remote mutations.', sourceRef: process.env.COAST_AUDIT_SOURCE_REF ?? 'unrecorded', executableSha256: createHash('sha256').update(await Bun.file(process.argv[1]).bytes()).digest('hex'), runtime: Bun.version, revision: Bun.revision, calls: [], checks: [], yields: 0 };
const check = (v: any, k: string) => {
    report.checks.push({ name: k, passed: !!v });
    if (!v) throw Error(k);
};
try {
    const [marker] = await client `select shobj_description(oid,'pg_database') marker from pg_database where datname=current_database()`;
    check(marker.marker === copy.marker, 'owned-copy');
    const [admin] = await client `select id from users where username='admin' and role='admin'`;
    const [account] = await client `select c.id from provider_connections c join provider_instances i on i.id=c.instance_id where c.user_id=${admin.id} and c.status='connected' and i.provider='jellyfin' and i.enabled order by c.id limit 1`;
    await client `update system_settings set value=value||'{"experimentalBooks":false,"experimentalComics":false}'::jsonb where key='coast'`;
    const features = await getFeatureConfig(admin.id), signature = ['screen', 'music', 'book', 'comic'].map(k => Number(features.features[k as keyof typeof features.features])).join('');
    const context = await getJellyfin(admin.id, account.id), origin = new URL(instanceServerUrl(context.instance)), fetch = globalThis.fetch;
    const addresses = new Set((await lookup(origin.hostname, { all: true })).map(a => a.address));
    globalThis.fetch = (async (input: any, init: any) => {
        const url = new URL(typeof input === 'string' ? input : input.url ?? input.href);
        report.guard = { method: init?.method ?? 'GET', protocolMatches: url.protocol === origin.protocol, portMatches: url.port === origin.port, addressMatches: addresses.has(url.hostname.replace(/^\[|\]$/g, '')), hostMatches: new Headers(init?.headers).get('Host') === origin.host };
        check((init?.method ?? 'GET') === 'GET' && url.protocol === origin.protocol && url.port === origin.port && addresses.has(url.hostname.replace(/^\[|\]$/g, '')) && new Headers(init?.headers).get('Host') === origin.host && report.calls.length < 8, 'bounded-real-read-only-provider-access');
        report.calls.push({ method: 'GET', kind: url.pathname.endsWith('/System/Info/Public') ? 'identity' : 'access-proof' });
        return fetch(input, init);
    }) as any;
    const [job] = await client `select id,attempts from outbox_actions where user_id=${admin.id} and connection_id=${account.id} and kind='jellyfin.sync' order by created_at limit 1`;
    check(job, 'existing-native-sync-job');
    const attempt = Number(job.attempts) + 1, scanId = crypto.randomUUID(), startedAt = new Date().toISOString();
    const progress = { featureSignature: signature, processed: 0, total: null, startedAt, scanId, accountGeneration: context.connection.accountGeneration, resetId: context.connection.settings.userSyncResetId, phase: 'finalizing', finalizationPhase: 'screen', finalizationCursor: null, finalizationCategory: null, stageProcessed: 0, stageTotal: null };
    await client `update provider_connections set settings=settings||jsonb_build_object('reconcileTracking',true,'userSync',${progress}::jsonb) where id=${account.id}`;
    await client `insert into sync_checkpoints(connection_id,kind,cursor,scan_id,completed_at) values(${account.id},'jellyfin-user','0',${scanId},null) on conflict(connection_id,kind) do update set scan_id=excluded.scan_id,cursor='0',completed_at=null`;
    await client `update availability set scan_id=${scanId} where connection_id=${account.id}`;
    await client `update outbox_actions set state='running',attempts=${attempt},payload='{}'::jsonb where id=${job.id}`;
    for (let n = 0; n < 4; n++) {
        const execution = { id: job.id, attempts: attempt, purpose: 'scheduled' as const, started: performance.now(), checkpoints: 0, userId: admin.id, kind: 'jellyfin.sync', payload: {} };
        try {
            await jobExecution.run(execution, () => syncJellyfinUser(admin.id, account.id));
            break;
        }
        catch (e) {
            if (!(e instanceof JobYield))
                throw e;
            report.yields++;
        }
    }
    const [final] = await client `select settings->'userSync'->>'phase' phase from provider_connections where id=${account.id}`;
    check(final.phase === 'complete', 'whole-native-finalization-resumes-to-completion');
    const [checkpoint] = await client `select scan_id,completed_at from sync_checkpoints where connection_id=${account.id} and kind='jellyfin-user'`;
    check(checkpoint.scan_id === null && checkpoint.completed_at, 'whole-native-checkpoint-completes');
}
catch (e: any) {
    report.failure = { name: e.name, code: e.code ?? e.cause?.code, message: String(e.message).split('\nparams:')[0].split('\nquery:')[0].slice(0, 160) };
    process.exitCode = 1;
}
finally {
    try {
        await closeDb();
    }
    catch {
        report.failure = { name: 'cleanup-failed' };
        process.exitCode = 1;
    }
    report.status = report.failure ? 'failed' : 'passed';
    writeFileSync(process.argv[2] ?? '/tmp/coast-performance-finalization.json', JSON.stringify(report, null, 2));
}
