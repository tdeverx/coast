// Export original Trakt rating observations privately, using existing credentials on a local Coast copy.
import {createHash, randomUUID} from 'node:crypto';
import {access, link, open, readFile, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {closeDb, getSql} from '../../../src/lib/server/db';
import {getConfig} from '../../../src/lib/server/config';
import {decryptCredential} from '../../../src/lib/server/security/credentials';
import {createProviderTransport} from '../../../src/lib/server/security/provider-fetch';
import {connectionFor} from '../../../src/lib/providers/connections.server';
import {instanceFetchConfig} from '../../../src/lib/providers/instances.server';
import {traktAllows} from '../../../src/lib/providers/trakt/access';
import {TraktAdapter, type TraktRecord} from '../../../src/lib/providers/trakt/adapter.server';
import {anthologyTmdb, anthologyTrakt} from '../../../src/lib/catalogue/anthology.server';

type Medium = 'movie' | 'show';
type Observation = {id:string;medium:Medium;stars:number|null;at:string|null};
type Mapping = {ordinal:number;id:string;story:boolean};
const hash = (v:string) => createHash('sha256').update(v).digest('hex');
class ExportError extends Error {}
function ensure(condition:unknown, explanation:string):asserts condition {
  if (!condition) throw new ExportError(explanation);
}

/** Match only known stable IDs from the provider's typed movie/show object. */
function keys(records:TraktRecord[]) {
  const output:{ordinal:number;kind:string;provider:string;external_id:string}[] = [];
  for (const [ordinal, record] of records.entries()) {
    const kind = record.type;
    if (kind !== 'movie' && kind !== 'show') continue;
    const ids = record[kind]?.ids;
    for (const provider of ['trakt','tmdb','imdb','tvdb'] as const) {
      const id = ids?.[provider];
      if (provider === 'imdb' ? typeof id === 'string' && /^tt[0-9]+$/.test(id)
        : typeof id === 'number' && Number.isSafeInteger(id) && id > 0) {
        output.push({ordinal,kind,provider,external_id:String(id)});
        // A remote single-series rating mapped to a Coast anthology season is a season rating.
        if (kind === 'show' && (provider === 'trakt' || provider === 'tmdb'))
          output.push({ordinal,kind:'season',provider:provider === 'trakt' ? anthologyTrakt : anthologyTmdb,external_id:String(id)});
      }
    }
  }
  return output;
}

async function mapPage(records:TraktRecord[]) {
  const sql = getSql(), wanted = keys(records);
  if (!wanted.length) return [];
  return sql<Mapping[]>`select k.ordinal, m.id, (k.kind='season' or (m.kind='show' and exists (
    select 1 from seasons s join external_ids a on a.media_id=s.media_id
    where s.show_id=m.id and a.provider=${anthologyTmdb}
  ))) as story from jsonb_to_recordset(${sql.json(wanted)}) as k(ordinal int, kind text, provider text, external_id text)
    join external_ids e on (e.provider,e.media_kind,e.external_id)=(k.provider,k.kind,k.external_id)
    join media m on m.id=e.media_id and m.kind=k.kind`;
}

function originalDate(value:string|undefined) {
  if (!value || !/(Z|[+-]\d\d:\d\d)$/i.test(value) || !Number.isFinite(Date.parse(value))) return null;
  return value; // Keep the provider's original precision, including times that collide at millisecond precision.
}

export function observations(records:TraktRecord[], mappings:Mapping[]) {
  const byRecord = new Map<number, Mapping[]>();
  for (const item of mappings) {
    const existing = byRecord.get(item.ordinal) ?? [];
    existing.push(item); byRecord.set(item.ordinal,existing);
  }
  const rows:Observation[] = [];
  let unresolved = 0, ambiguous = 0, stories = 0;
  for (const [ordinal,r] of records.entries()) {
    if (r.type !== 'show' && r.type !== 'movie') continue;
    const found = byRecord.get(ordinal) ?? [];
    const candidates = new Set(found.filter(x=>!x.story).map(x=>x.id));
    const hasStory = found.some(x=>x.story);
    if (!candidates.size) {
      if (hasStory) stories++;
      else unresolved++;
    } else if (candidates.size > 1 || hasStory) {
      // A possibly older ambiguous observation must not let a later edit masquerade as the first rating.
      ambiguous++;
      for (const id of candidates) rows.push({id,medium:r.type,stars:null,at:null});
    } else {
      const [id] = candidates;
      const stars = typeof r.rating === 'number' && Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 10
        ? r.rating/2 : null;
      rows.push({id,medium:r.type,stars,at:originalDate(r.rated_at)});
    }
  }
  return {rows,unresolved,ambiguous,stories};
}

async function adapterFor(userId:string, connectionId:string) {
  const {instance,connection} = await connectionFor(userId,connectionId,'trakt');
  ensure((await getConfig()).enableTrakt && instance.enabled && connection.credentials && instance.credentials
    && !connection.settings.traktIdentityPending && traktAllows(connection.settings,'import','ratings'),
    'The copied connection does not permit a verified Trakt ratings import.');
  // Avoid getTrakt's rotating refresh flow. This collector can issue only these three GET requests.
  const token = JSON.parse(await decryptCredential(connection.credentials));
  const client = JSON.parse(await decryptCredential(instance.credentials));
  ensure(typeof token.access_token === 'string' && typeof client.clientId === 'string'
    && Number.isFinite(token.created_at) && Number.isFinite(token.expires_in)
    && (token.created_at + token.expires_in) * 1000 > Date.now()+60_000,
    'The copied token is expired or incomplete. Use a fresh authorised copy.');
  const transport = createProviderTransport(await instanceFetchConfig(instance));
  const adapter = new TraktAdapter((path, init)=>{
    ensure((init?.method ?? 'GET') === 'GET' && (
      path === '/users/settings' || path === '/sync/last_activities' || /^\/sync\/ratings\?page=[1-9]\d*&limit=100&extended=full$/.test(path)
    ), 'Only read-only Trakt rating observations are allowed.');
    return transport(path,init);
  },client.clientId,'',token.access_token);
  ensure((await adapter.profile()).id === connection.externalUserId, 'The remote account differs from the verified connection.');
  return adapter;
}

async function main() {
  const [username,ledger,output] = Bun.argv.slice(2);
  ensure(username && ledger && output && Bun.argv.length === 5,'Expected USERNAME PRIVATE_SEALED_LEDGER NEW_PRIVATE_RATING_EXPORT.');
  const url = new URL(process.env.DATABASE_URL || 'file:///missing');
  ensure(['postgresql:','postgres:'].includes(url.protocol) && ['127.0.0.1','[::1]'].includes(url.hostname)
    && url.pathname === '/taste_card_benchmark', 'Use the explicitly named local taste_card_benchmark database copy.');
  ensure(process.env.COAST_DATA_DIR, 'Set COAST_DATA_DIR to the private development copy.');
  await access(join(process.env.COAST_DATA_DIR,'secrets','credentials.key'));
  const seal = JSON.parse(await readFile(ledger,'utf8'));
  ensure(seal.format === 'coast-prospective-audience' && seal.version === 1 && seal.manifest?.accountKey,
    'Expected a sealed Coast audience ledger.');
  const sql = getSql();
  const links = await sql<{viewer:string;id:string}[]>`select u.id as viewer,c.id from users u
    join provider_connections c on c.user_id=u.id join provider_instances i on i.id=c.instance_id
    where lower(u.username)=lower(${username}) and not u.disabled and c.status='connected'
      and i.provider='trakt' and i.enabled and not coalesce((c.settings->>'traktIdentityPending')::boolean,false)`;
  ensure(links.length===1, 'Expected exactly one verified Trakt connection for the specified viewer.');
  const accountKey = hash('coast-prospective-audience:'+links[0].viewer);
  ensure(accountKey === seal.manifest.accountKey,'This account does not own the supplied prospective ledger.');
  const adapter = await adapterFor(links[0].viewer,links[0].id);
  const activity = await adapter.lastActivity();
  const pages = new Set<string>(), events = new Map<string,Observation>();
  let remote = 0, unresolved = 0, ambiguous = 0, stories = 0;
  for (let page=1; ; page++) {
    const records = await adapter.read('ratings',page);
    ensure(records.length <= 100,'Unexpected Trakt page size.');
    remote += records.length;
    const mapped = observations(records,await mapPage(records));
    for (const r of mapped.rows) events.set(JSON.stringify(r), r);
    unresolved += mapped.unresolved; ambiguous += mapped.ambiguous; stories += mapped.stories;
    if (records.length < 100) break;
    const signature = hash(JSON.stringify(records));
    ensure(!pages.has(signature),'Trakt returned a repeated full page. No export was published.');
    pages.add(signature);
  }
  ensure(activity === await adapter.lastActivity(),'Trakt activity changed during pagination. Retry to obtain a stable reading.');
  const ratings = [...events.values()];
  const temporary = output+'.'+randomUUID()+'.tmp';
  const file = await open(temporary,'wx',0o600);
  try {
    await file.writeFile(JSON.stringify({accountKey,source:'trakt/sync/ratings',readAt:new Date().toISOString(),ratings}));
    await file.sync();
    await link(temporary,output);
  } finally {
    try { await file.close(); } finally { await unlink(temporary); }
  }
  console.log(JSON.stringify({remoteRecords:remote,records:ratings.length,unresolved,ambiguous,anthologySeasons:stories,
    undated:ratings.filter(r=>!r.at).length}));
}

if (import.meta.main) {
  try { await main(); }
  catch (e) {
    // Some adapter validation errors contain a full provider response. Print no titles, credentials or private errors.
    console.error(e instanceof ExportError ? e.message : 'The private read did not complete. Verify the copy, token, network and new output path.');
    process.exitCode = 1;
  } finally { await closeDb(); }
}
