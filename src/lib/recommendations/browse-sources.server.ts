import { sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import type { DynamicKind, DynamicMedium } from './model';
import type { BrowseSources } from './row-catalog';

export async function browseSources(category: DynamicMedium | undefined, enableTrakt: boolean): Promise<BrowseSources & { igdbId?: string }> {
  const providers = [...(!category || category==='screen' ? ['tmdb','seerr',...(enableTrakt?['trakt']:[])] : []),
    ...(!category || category==='game' ? ['igdb'] : []), ...(!category || category==='reading' ? ['comic-vine'] : [])];
  const rows = providers.length ? await getDb().execute<{provider:string;id:string}>(sql`
    select distinct on (provider) provider,id from provider_instances
    where provider in (${sql.join(providers.map(value=>sql`${value}`),sql`, `)}) and enabled and credentials is not null
    order by provider,id`) : [];
  const tmdb = rows.some(row=>row.provider==='tmdb'), trakt = rows.some(row=>row.provider==='trakt');
  const igdbId = rows.find(row=>row.provider==='igdb')?.id;
  return { tmdb,trakt,screen:tmdb||trakt,game:!!igdbId,igdbId,comics:rows.some(row=>row.provider==='comic-vine'),seerr:rows.some(row=>row.provider==='seerr') };
}

// The viewer's usable library is a single indexed scan. Episode files make
// their show eligible, while Steam ownership never implies installation.
export async function libraryKinds(userId: string | null) {
  if (!userId) return new Set<DynamicKind>();
  const rows = await getDb().execute<{kind:DynamicKind}>(sql`
    select distinct w.kind from availability a join provider_connections c on c.id=a.connection_id
    join provider_instances i on i.id=c.instance_id and i.enabled
    left join episodes e on e.media_id=a.media_id join works w on w.id=coalesce(e.show_id,a.media_id)
    where a.user_id=${userId} and c.user_id=${userId} and c.status='connected' and a.state='available'
      and (i.provider='jellyfin' or (i.provider='steam' and a.source_id='steam-owned'))
      and w.kind in ('movie','show','album','game','book','comic')`);
  return new Set(rows.map(row=>row.kind));
}
