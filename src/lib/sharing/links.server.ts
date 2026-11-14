import { getSql } from '#lib/server/db/index.js';
import * as v from 'valibot';
import { requireUser, type SessionUser } from '#lib/server/auth/index.js';
import { decryptCredential } from '#lib/server/security/credentials.js';
import { AppError } from '#lib/server/security/errors.js';
import { workCards } from '#lib/collection/query.server.js';
import type { MediaCardDisplay } from '#lib/ui/types.js';
import { publicSharePath, viewerIdleSeconds } from './policy';
import { assertShare } from './service.server';
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
  const rows = await db<{ id: string; workId: string; kind: 'movie'|'episode'|'track'; target: ShareTarget; title: string; expiresAt: Date; viewers: number; canCopy: boolean }[]>`
    select s.id,s.work_id as "workId",w.kind,s.target,coalesce(m.title,mw.title,'Shared item') as title,s.expires_at as "expiresAt",
      s.encrypted_token is not null as "canCopy",
      (select count(*)::int from share_viewers v join playback_sessions p on p.id=v.playback_id
       where v.share_id=s.id and v.ended_at is null and p.state<>'stopped'
         and v.last_seen_at>now()-${viewerIdleSeconds}*interval '1 second') as viewers
    from playback_shares s
    join works w on w.id=s.work_id
    left join media m on m.id=s.work_id
    left join music_works mw on mw.id=s.work_id
    where ${activeLinks(db, user.id)}
    order by s.created_at desc,s.id desc limit 20
  `;
  const cards = new Map((await workCards(user.id, user.id, [...new Set(rows.map(row => row.workId))]))
    .map(card => [('workId' in card ? card.workId : undefined) ?? card.id, card]));
  return rows.map(({ workId, kind, expiresAt, ...link }) => {
    const fallback: MediaCardDisplay = { id: workId, kind, title: link.title, href: null };
    return { ...link, expiresAt: expiresAt.toISOString(), card: cards.get(workId) ?? fallback };
  });
}

/** The list carries only copy availability. Reveal the URL on explicit owner demand. */
export async function copySharePath(actor: SessionUser | null, id: string) {
  const user = requireUser(actor), db = getSql();
  const [share] = await db<{id:string; encrypted_token:string|null; target:ShareTarget}[]>`
    select s.id,s.encrypted_token,s.target from playback_shares s
    where s.id=${v.parse(v.pipe(v.string(),v.uuid()),id)} and ${activeLinks(db,user.id)}`;
  if (!share) throw new AppError(404, 'Active link not found.');
  if (!share.encrypted_token) throw new AppError(409, 'This link was created before copying from Active Links was available.');
  await assertShare(share);
  return {path:publicSharePath(await decryptCredential(share.encrypted_token), share.target)};
}
