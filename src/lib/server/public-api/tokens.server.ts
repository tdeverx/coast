import * as v from 'valibot';
import { getSql } from '$lib/server/db';
import { hashToken, randomToken, requireUser, type SessionUser } from '$lib/server/auth';
import { onboardingPending } from '$lib/server/auth/onboarding';
import { AppError } from '$lib/server/security/errors';
import { apiScopes } from '$lib/public-api';

const inputSchema = v.object({
  name:v.pipe(v.string(),v.trim(),v.minLength(1),v.maxLength(60)),
  scopes:v.pipe(v.array(v.picklist(apiScopes)),v.minLength(1),v.maxLength(apiScopes.length)),
  days:v.optional(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(365)),90),
});
export async function listApiTokens(actor: SessionUser|null) {
  const user=requireUser(actor);
  return getSql()`select id,name,scopes,expires_at as "expiresAt",revoked_at as "revokedAt",last_used_at as "lastUsedAt",created_at as "createdAt"
    from api_tokens where user_id=${user.id} order by (revoked_at is null and expires_at>now()) desc,created_at desc limit 50`;
}
export async function createApiToken(actor: SessionUser|null,input:unknown) {
  const user=requireUser(actor), settings=v.parse(inputSchema,input);
  if(await onboardingPending(user.id)) throw new AppError(403,'Complete onboarding first.','onboarding_required');
  const token=`coast_${randomToken()}`, hash=await hashToken(token);
  const expiresAt=new Date(Date.now()+settings.days*86400000);
  const id=await getSql().begin(async sql=>{
    const active=await sql`select id from users where id=${user.id} and not disabled for update`;
    if(!active.length)throw new AppError(401,'Account unavailable.','invalid_token');
    const [count]=await sql`select count(*)::int as total from api_tokens where user_id=${user.id} and revoked_at is null and expires_at>now()`;
    if(count.total>=20) throw new AppError(409,'Revoke an existing token before creating another.','token_limit');
    const [row]=await sql`insert into api_tokens(user_id,name,token_hash,scopes,expires_at) values(${user.id},${settings.name},${hash},${JSON.stringify([...new Set(settings.scopes)])}::jsonb,${expiresAt}) returning id`;
    return row.id as string;
  });
  return {id,token,expiresAt};
}
export async function revokeApiToken(actor:SessionUser|null,id:string) {
  const user=requireUser(actor);
  const rows=await getSql()`update api_tokens set revoked_at=coalesce(revoked_at,now()) where id=${id} and user_id=${user.id} returning id`;
  if(!rows.length) throw new AppError(404,'Token not found.','not_found');
}
export async function authenticateApiToken(request:Request) {
  const authorization=request.headers.get('authorization')??'';
  if(!/^Bearer coast_[A-Za-z0-9_-]{43}$/.test(authorization)) throw new AppError(401,'Supply a valid Bearer token.','invalid_token');
  const hash=await hashToken(authorization.slice(7));
  const [row]=await getSql()`select t.id,t.user_id as "userId",t.scopes,u.username from api_tokens t join users u on u.id=t.user_id
    where t.token_hash=${hash} and t.revoked_at is null and t.expires_at>now() and not u.disabled`;
  if(!row) throw new AppError(401,'This token is invalid or expired.','invalid_token');
  if(await onboardingPending(row.userId)) throw new AppError(403,'Complete onboarding first.','onboarding_required');
  // Atomic durable quota: concurrent requests and multiple server workers share one budget.
  const accepted=await getSql()`update api_tokens set window_requests=case when window_started_at<=now()-interval '1 minute' then 1 else window_requests+1 end,
    window_started_at=case when window_started_at<=now()-interval '1 minute' then now() else window_started_at end,last_used_at=now()
    where id=${row.id} and revoked_at is null and expires_at>now() and (window_started_at<=now()-interval '1 minute' or window_requests<120) returning id`;
  if(!accepted.length) throw new AppError(429,'Wait a minute before making more requests.','rate_limited');
  return {id:row.userId as string,username:row.username as string,scopes:row.scopes as string[]};
}
