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
import { featureDenialMessage,getFeatureConfig } from '#lib/server/features.js';
import { categoryEnabled } from '#lib/experimental.js';
import type { MediaCategory } from '#lib/media/model.js';

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
  const rows = await db<{ id:string;workId:string;kind:'movie'|'episode'|'track'|'book'|'comic';category:MediaCategory;
    target:ShareTarget;title:string;expiresAt:Date;viewers:number;canCopy:boolean;accessible:boolean;together:boolean;codec:string }[]>`
    select s.id,s.work_id as "workId",w.kind,w.category,s.target,s.together,s.video_codec as codec,
      coalesce(m.title,mw.title,rw.title,'Shared item') as title,s.expires_at as "expiresAt",
      s.encrypted_token is not null as "canCopy",
      c.status='connected' and c.account_generation=s.account_generation and i.enabled and exists(
        select 1 from availability a join provider_items pi on pi.id=a.provider_item_id
        where a.user_id=s.owner_id and a.connection_id=s.connection_id and a.media_id=s.work_id and a.state='available'
          and (w.kind not in ('book','comic') or replace(lower(pi.external_id),'-','')=replace(lower(s.source_id),'-',''))
      ) as accessible,
      (select count(*)::int from share_viewers v left join playback_sessions p on p.id=v.playback_id left join reading_sessions r on r.id=v.reading_session_id
       where v.share_id=s.id and v.ended_at is null and (p.state<>'stopped' or r.closed_at is null and r.expires_at>now())
         and v.last_seen_at>now()-${viewerIdleSeconds}*interval '1 second') as viewers
    from playback_shares s
    join works w on w.id=s.work_id
    left join provider_connections c on c.id=s.connection_id and c.user_id=s.owner_id
    left join provider_instances i on i.id=c.instance_id
    left join media m on m.id=s.work_id
    left join music_works mw on mw.id=s.work_id
    left join reading_works rw on rw.id=s.work_id
    where ${activeLinks(db, user.id)}
    order by s.created_at desc,s.id desc limit 20
  `;
  if(!rows.length)return [];
  const [config,items]=await Promise.all([getFeatureConfig(user.id),workCards(user.id,user.id,[...new Set(rows.map(row=>row.workId))])]);
  const cards = new Map(items
    .map(card => [('workId' in card ? card.workId : undefined) ?? card.id, card]));
  return rows.map(({workId,kind,category,expiresAt,accessible,together,codec,canCopy,...link}) => {
    const fallback: MediaCardDisplay = { id: workId, kind, title: link.title, href: null };
    const unavailable=!config.features.sharing?featureDenialMessage(config.featureDenials.sharing)
      :user.role!=='admin'&&user.settings.allowPlaybackSharing!==true?'A Coast admin needs to grant playback sharing.'
      :!categoryEnabled(config,category)?'This medium is disabled.'
      :!accessible?'The shared Jellyfin source is no longer accessible.'
      :together&&!config.features.parties?'This link requires Parties.'
      :link.target==='vrchat'&&(!config.allowTranscoding||codec==='hevc'&&!config.allowVrchatHevc)?'This VRChat sharing profile is disabled.'
      :['book','comic'].includes(kind)&&!config.features.reader?'This link requires File reader access.'
      :undefined;
    return {...link,canCopy:canCopy&&!unavailable,copyUnavailable:unavailable??(!canCopy?'This link has no saved URL.':undefined),
      expiresAt:expiresAt.toISOString(),card:cards.get(workId)??fallback};
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
