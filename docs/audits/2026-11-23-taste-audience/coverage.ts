import { SQL } from 'bun';

type Label = { id: string; at: string };
const [verifiedDates] = process.argv.slice(2);
if (!verifiedDates || !process.env.DATABASE_URL) throw Error('Supply the private rating-date file and local copy URL.');
const database = new URL(process.env.DATABASE_URL);
if (database.hostname !== '127.0.0.1' || database.port !== '55490' || database.pathname !== '/taste_card_benchmark') {
  throw Error('Expected the isolated Coast research copy.');
}
const labels: Label[] = await Bun.file(verifiedDates).json();
const sql = new SQL({ url: database.href, max: 1 });
try {
  const result = await sql.begin(async tx => {
    await tx.unsafe('set transaction read only');
    return tx`
      with personal as (
        select * from jsonb_to_recordset(${tx.json(labels)}) as t(id uuid, at timestamptz)
      ), votes as (
        select m.media_id, m.updated_at
        from metadata_snapshots m where m.provider='tmdb'
          and (m.raw#>>'{facts,audience,votes}')::numeric > 0
          and (m.raw#>>'{facts,audience,scale}')::numeric=10
          and (m.raw#>>'{facts,audience,score}')::numeric between 0 and 10
      )
      select (select min(updated_at) from votes) as earliest_copy_observation,
        (select max(updated_at) from votes) as latest_copy_observation,
        min(p.at) as first_rating, max(p.at) as last_rating,
        count(*)::int as rated, count(v.media_id)::int as with_votes,
        count(*) filter(where v.first_observed < p.at)::int as prior_to_personal_rating
      from personal p left join (
        select media_id, min(updated_at) as first_observed from votes group by media_id
      ) v on v.media_id=p.id
    `;
  });
  console.log(JSON.stringify(result[0], null, 2));
} finally {
  await sql.close();
}
