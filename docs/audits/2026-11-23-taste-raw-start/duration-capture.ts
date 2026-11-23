import assert from 'node:assert/strict';
import {open} from 'node:fs/promises';
import {closeDb,getSql} from '../../../src/lib/server/db';

const db=new URL(process.env.DATABASE_URL!);
assert(db.hostname==='127.0.0.1' && db.pathname==='/taste_card_benchmark' && Bun.argv[2]);
try {
  const sql=getSql();
  const rows=await sql`with episode as (
    select e.show_id,percentile_cont(.5) within group (order by coalesce(e.runtime_minutes,m.runtime_minutes)) as minutes
    from episodes e join media m on m.id=e.media_id
    where e.season_number=1 and e.episode_number>0 and not e.is_special and coalesce(e.runtime_minutes,m.runtime_minutes)>0
    group by e.show_id
  ) select m.id,m.kind,case when m.kind='show' then coalesce(e.minutes,nullif(m.runtime_minutes,0)) else m.runtime_minutes end as minutes
    from media m left join episode e on e.show_id=m.id where m.kind in ('movie','show')`;
  const out=await open(Bun.argv[2],'wx',0o600);
  try {await out.writeFile(JSON.stringify(rows));} finally {await out.close();}
  console.log(rows.length,'movie and show durations captured');
} finally {await closeDb();}
