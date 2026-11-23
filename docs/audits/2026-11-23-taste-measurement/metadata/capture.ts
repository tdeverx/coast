// Read title metadata from the local replay copy. Output contains private cohort IDs and is written outside source control.
import {SQL} from 'bun';
import {writeFile} from 'node:fs/promises';

const [source,output]=Bun.argv.slice(2);
if (!source||!output||!process.env.DATABASE_URL) throw Error('Usage: bun capture.ts <frozen-replay.json> <private-output.json>');
const url=new URL(process.env.DATABASE_URL);
if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw Error('Use the local development copy.');
const data=await Bun.file(source).json();
const ids=[...new Set(data.flatMap(m=>[...m.catalogue.map(x=>x.id),...m.history.map(x=>x.work.id)]))];
const sql=new SQL({url:url.href,max:1});
try {
  const rows=await sql.begin(async tx=>{
    await tx.unsafe('set transaction read only');
    return tx`select m.id,m.kind,m.title,coalesce(nullif(btrim(o.overview),''),nullif(btrim(tm.overview),''),nullif(btrim(m.overview),''),
      nullif(btrim(tr.overview),''),nullif(btrim(j.overview),'')) as overview,m.runtime_minutes,tm.raw#>'{facts,credits}' credits
      from media m left join metadata_overrides o on o.media_id=m.id
      left join lateral(select overview,raw from metadata_snapshots where media_id=m.id and provider='tmdb'
        order by (language='en') desc,updated_at desc,id limit 1) tm on true
      left join lateral(select overview from metadata_snapshots where media_id=m.id and provider='trakt'
        order by (language='en') desc,updated_at desc,id limit 1) tr on true
      left join lateral(select overview from metadata_snapshots where media_id=m.id and provider='jellyfin'
        order by (language='en') desc,updated_at desc,id limit 1) j on true
      where m.id=any(${tx.array(ids,'UUID')}::uuid[])`;
  });
  await writeFile(output,JSON.stringify(rows),{mode:0o600});
  console.log('Captured titles',rows.length);
} finally {
  await sql.close();
}
