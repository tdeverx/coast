// Read only the public vote statistics for stable-ID matched research titles.
import {writeFile} from 'node:fs/promises';
import {closeDb, getSql} from '../../../src/lib/server/db';
import {decryptCredential} from '../../../src/lib/server/security/credentials';
import {createProviderTransport, ProviderHttpError} from '../../../src/lib/server/security/provider-fetch';
import {authenticatedTmdbTransport, type TmdbCredentials} from '../../../src/lib/providers/tmdb/connection.server';

type Target = {id:string; kind:'movie'|'show'; name:string; external:string[]};
type Votes = {id:string; score:number; votes:number; observedAt:string};

async function main() {
  const [graded,metadata,output] = Bun.argv.slice(2);
  if (!output) throw Error('Pass the frozen native replay, credit metadata and a new private output file.');
  const url = new URL(process.env.DATABASE_URL ?? 'file:///missing');
  if (!['127.0.0.1','[::1]'].includes(url.hostname) || url.pathname !== '/taste_card_benchmark')
    throw Error('Expected the explicitly named local research database.');
  const replay = await Bun.file(graded).json();
  const titles = new Map<string,string>((await Bun.file(metadata).json()).map((m:{id:string;title:string})=>[m.id,m.title]));
  const ids:string[] = replay.runs.filter((p:{split:string;budget:string})=>p.split==='work' && p.budget==='all')
    .flatMap((p:{targets:{id:string}[]})=>p.targets.map(t=>t.id));
  const sql=getSql();
  const [service]=await sql<{credentials:string}[]>`select credentials from provider_instances
    where provider='tmdb' and enabled and credentials is not null order by id limit 1`;
  if (!service) throw Error('TMDB has no enabled credential on the copy.');
  const credential:TmdbCredentials=JSON.parse(await decryptCredential(service.credentials));
  const request=authenticatedTmdbTransport(createProviderTransport({provider:'tmdb',baseUrl:'https://api.themoviedb.org',
    approved:true,allowedPorts:[443]}),credential);
  const targets=await sql<Target[]>`select m.id,m.kind,m.title as name,
    coalesce(array_agg(e.external_id order by e.external_id) filter(where e.external_id is not null),'{}') as external
    from media m left join external_ids e on e.media_id=m.id and e.media_kind=m.kind and e.provider='tmdb'
    where m.id=any(${sql.array(ids,'UUID')}::uuid[]) and m.kind in ('movie','show') group by m.id`;
  if (targets.length!==new Set(ids).size) throw Error('Research IDs do not match this catalogue.');
  const examples=new Set(['Farzar','Rick and Morty']);
  targets.sort((a,b)=>Number(examples.has(titles.get(b.id)??''))-Number(examples.has(titles.get(a.id)??'')) || a.id.localeCompare(b.id));
  const rows:Votes[]=[];
  const misses:{id:string;reason:string}[]=[];
  let offset=0;
  async function worker() {
    while (offset<targets.length) {
      const item=targets[offset++];
      if (item.external.length!==1 || !/^[1-9][0-9]*$/.test(item.external[0])) {
        misses.push({id:item.id,reason:'missing-or-ambiguous-id'});
        continue;
      }
      const id=item.external[0], path='/3/'+(item.kind==='show'?'tv':'movie')+'/'+id;
      for (let attempt=0; ;attempt++) {
        try {
          const r=await request(path,{method:'GET'}) as {id:number;vote_average:number;vote_count:number};
          if (String(r.id)!==id) throw Error('TMDB returned a different ID.');
          if (Number.isSafeInteger(r.vote_count) && r.vote_count>0 && r.vote_average>0 && r.vote_average<=10) {
            rows.push({id:item.id,score:r.vote_average,votes:r.vote_count,observedAt:new Date().toISOString()});
            if (examples.has(titles.get(item.id)??'')) console.log(JSON.stringify({title:titles.get(item.id),score:r.vote_average,votes:r.vote_count}));
          } else misses.push({id:item.id,reason:'no-votes'});
          break;
        } catch (error) {
          if (error instanceof ProviderHttpError && error.status===404) {
            misses.push({id:item.id,reason:'not-found'});
            break;
          }
          if (error instanceof ProviderHttpError && (error.status===401 || error.status===403)) throw error;
          if (attempt>=2) throw Error('TMDB read failed three times; no partial study source published.');
          await Bun.sleep(Math.max(attempt+1,error instanceof ProviderHttpError ? error.retryAfterSeconds??0 : 0)*1000);
        }
      }
      await Bun.sleep(180);
    }
  }
  await Promise.all([worker(),worker(),worker()]);
  const readAt=new Date().toISOString();
  await writeFile(output,JSON.stringify({readAt,source:'TMDB REST movie and tv details',rows,misses}),
    {flag:'wx',mode:0o600});
  console.log(JSON.stringify({requested:ids.length,received:rows.length,missing:misses.length,readAt}));
}

try {await main();}
catch (error) {console.error(error instanceof ProviderHttpError ? 'TMDB status '+error.status :
  'Public vote export failed. Check the local copy, provider access and new output path.'); process.exitCode=1;}
finally {await closeDb();}
