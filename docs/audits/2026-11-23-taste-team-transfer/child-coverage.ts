// Can episode or season ratings contribute a new low-opinion donor from another show?
import { SQL } from 'bun';

const [viewer] = Bun.argv.slice(2);
if (!viewer || !Bun.env.DATABASE_URL) throw new Error('Supply the viewer and local research database.');
const url = new URL(Bun.env.DATABASE_URL);
if (url.hostname !== '127.0.0.1' || url.port !== '55490' || url.pathname !== '/taste_card_benchmark') {
  throw new Error('Expected the isolated Coast research copy.');
}
const sql = new SQL({ url: url.href, max: 1 });
try {
  const result = await sql.begin(async tx => {
    await tx.unsafe('set transaction read only');
    return tx`
      with opinions as (
        select r.media_id, r.value, r.source from ratings r
        join users u on u.id=r.user_id and u.username=${viewer}
      ), parts as (
        select coalesce(e.show_id, s.show_id) as root, o.media_id, o.value,
          e.media_id is not null as episode, o.source
        from opinions o
        left join episodes e on e.media_id=o.media_id
        left join seasons s on s.media_id=o.media_id
        where e.show_id is not null or s.show_id is not null
      ), grouped as (
        select root, count(*) filter (where episode) as episodes,
          count(*) filter (where not episode) as seasons,
          max(value)<=2.5 as uniform_low, min(value)>=4.5 as uniform_high,
          count(*) filter (where value<=2.5 and episode) as low_episodes,
          count(*) filter (where value<=2.5 and not episode) as low_seasons
        from parts group by root
      )
      select count(*)::int as roots,
        sum(episodes)::int as episodes, sum(seasons)::int as seasons,
        sum(low_episodes)::int as low_episodes, sum(low_seasons)::int as low_seasons,
        count(*) filter (where direct.media_id is null)::int as roots_without_direct,
        sum(episodes) filter(where direct.media_id is null)::int as episodes_without_direct_root,
        sum(seasons) filter(where direct.media_id is null)::int as seasons_without_direct_root,
        count(*) filter (where direct.media_id is null and uniform_low)::int as unrated_roots_with_uniform_low,
        count(*) filter (where direct.media_id is null and uniform_high and (episodes>=3 or seasons>=2))::int as possible_new_positive_donors,
        count(*) filter (where uniform_low and (episodes>=3 or seasons>=2))::int as possible_donors_even_before_masks,
        count(*) filter (where uniform_low and (episodes>=3 or seasons>=2) and direct.media_id is null)::int as possible_new_donors,
        (select count(*) from parts where source='trakt')::int as imported_child_opinions
      from grouped g left join opinions direct on direct.media_id=g.root`;
  });
  console.log(JSON.stringify(result[0]));
} finally {
  await sql.close();
}
