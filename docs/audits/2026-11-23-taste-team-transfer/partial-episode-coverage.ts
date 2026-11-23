import { SQL } from 'bun';
import { writeFile } from 'node:fs/promises';

const db = new URL(process.env.DATABASE_URL!);
if (db.hostname !== '127.0.0.1' || db.port !== '55490' || db.pathname !== '/taste_card_benchmark') {
  throw Error('Expected the isolated research database copy');
}
const graded = await Bun.file(Bun.argv[2]).json();
const shows = graded.runs.find((r: { medium: string; split: string; budget: string }) =>
  r.medium === 'show' && r.split === 'work' && r.budget === 'all'
).targets.map((t: { id: string }) => t.id);
const sql = new SQL({ url: db.href, max: 1 });
try {
  const rows = await sql.begin(async tx => {
    await tx.unsafe('set transaction read only');
    return tx`
      select count(distinct e.show_id)::int as rated_shows_with_episodes,
        count(distinct e.media_id)::int as episodes,
        count(distinct e.media_id) filter (where c.has_writer)::int as episodes_with_writer,
        count(distinct e.show_id) filter (where c.has_writer)::int as shows_with_episode_writer
      from episodes e
      left join lateral (
        select true as has_writer from metadata_snapshots m
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(m.raw#>'{facts,credits}')='array' then m.raw#>'{facts,credits}' else '[]'::jsonb end
        ) x
        where m.media_id=e.media_id and m.provider='tmdb'
          and x->>'role' in ('Writer','Screenplay','Teleplay','Head Writer') and x->>'id' ~ '^[0-9]+$'
        limit 1
      ) c on true
      where e.show_id=any(${tx.array(shows,'UUID')}::uuid[])
    `;
  });
  console.log(JSON.stringify(rows[0]));
  const output = Bun.argv[3];
  if (output) {
    const episodes = await sql.begin(async tx => {
      await tx.unsafe('set transaction read only');
      return tx`
        select e.show_id, e.media_id, med.release_date::text as aired,
          coalesce(c.credits, '{}'::jsonb) as writers
        from episodes e join media med on med.id=e.media_id
        left join lateral (
          select jsonb_object_agg(w.person, w.first_observed) as credits
          from (
            select x->>'id' as person, min(s.updated_at at time zone 'UTC')::date::text as first_observed
            from metadata_snapshots s cross join lateral jsonb_array_elements(
              case when jsonb_typeof(s.raw#>'{facts,credits}')='array' then s.raw#>'{facts,credits}' else '[]'::jsonb end
            ) x
            where s.media_id=e.media_id and s.provider='tmdb' and x->>'id' ~ '^[0-9]+$'
              and x->>'role' in ('Writer','Screenplay','Teleplay','Head Writer')
            group by x->>'id'
          ) w
        ) c on true
        where e.show_id=any(${tx.array(shows,'UUID')}::uuid[]) and e.season_number>0 and not e.is_special
        order by e.show_id,e.media_id
      `;
    });
    await writeFile(output, JSON.stringify(episodes), { flag: 'wx', mode: 0o600 });
  }
} finally {
  await sql.close();
}
