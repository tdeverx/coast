import { getSql } from '#lib/server/db/index.js';
import { requireUser, type SessionUser } from '#lib/server/auth/index.js';
import { viewerIdleSeconds } from './policy';
import type { ShareTarget } from './vrchat-profile';

function activeLinks(db: ReturnType<typeof getSql>, ownerId: string) {
  return db`s.owner_id=${ownerId} and s.revoked_at is null and s.expires_at>now()`;
}

export async function activeShareExpiry(actor: SessionUser | null) {
  const user = requireUser(actor), db = getSql();
  const [row] = await db<{ expires_at: Date | null }[]>`
    select max(s.expires_at) as expires_at from playback_shares s where ${activeLinks(db, user.id)}
  `;
  return row.expires_at?.toISOString() ?? null;
}

export async function listActiveShares(actor: SessionUser | null) {
  const user = requireUser(actor), db = getSql();
  const rows = await db<{ id: string; target: ShareTarget; title: string; expiresAt: Date; viewers: number }[]>`
    select s.id,s.target,coalesce(m.title,mw.title,'Shared item') as title,s.expires_at as "expiresAt",
      (select count(*)::int from share_viewers v join playback_sessions p on p.id=v.playback_id
       where v.share_id=s.id and v.ended_at is null and p.state<>'stopped'
         and v.last_seen_at>now()-${viewerIdleSeconds}*interval '1 second') as viewers
    from playback_shares s
    left join media m on m.id=s.work_id
    left join music_works mw on mw.id=s.work_id
    where ${activeLinks(db, user.id)}
    order by s.created_at desc,s.id desc limit 20
  `;
  return rows.map(link => ({ ...link, expiresAt: link.expiresAt.toISOString() }));
}
