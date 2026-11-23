// Read-only research crosswalk to existing Coast metadata. Never export account ratings.
import { writeFile } from 'node:fs/promises';
import { SQL } from 'bun';

const url = new URL(process.env.DATABASE_URL!);
if (url.hostname !== '127.0.0.1' || url.port !== '55490' || url.pathname !== '/taste_card_benchmark') throw Error('Expected the copied database.');
const sql = new SQL({url:url.href,max:1});
try {
  const [ids, counts] = await sql.begin(async tx => {
    await tx.unsafe('set transaction read only');
    const ids = await tx`select media_id as id, provider, media_kind as kind, external_id as key
      from external_ids where media_kind in ('show','movie') and provider in ('tmdb','imdb')`;
    const counts = await tx`with person as (
      select r.user_id, count(*) as n, count(*) filter(where value<=2.5) as low
      from ratings r join media m on m.id=r.media_id where m.kind in ('movie','show') group by r.user_id)
      select count(*) as profiles, count(*) filter(where n>=25) as with_25,
             count(*) filter(where n>=25 and low>0) as with_25_and_a_dislike from person`;
    return [ids, counts];
  });
  await writeFile(Bun.argv[2],JSON.stringify(ids),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({identifiers:ids.length,profileCoverage:counts}));
} finally { await sql.close(); }
