import { sql } from 'drizzle-orm';
/** Ownership access; this is deliberately not installation or launchability evidence. */
export function ownedGameAvailable(userId:string) {
  return sql<boolean>`exists(select 1 from availability a join provider_connections c on c.id=a.connection_id join provider_instances i on i.id=c.instance_id
    where a.user_id=${userId} and a.media_id=games.id and a.state='available' and a.source_id='steam-owned'
      and c.user_id=${userId} and c.status='connected' and i.provider='steam' and i.enabled)`;
}
