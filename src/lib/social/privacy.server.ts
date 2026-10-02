import {getSql} from '$lib/server/db';
import {AppError} from '$lib/server/security/errors';
import type {SocialSection} from './model';
export async function canView(ownerId:string,viewerId:string|null,section:SocialSection,category?:string) {
  const [row]=await getSql()`select social_visible(${ownerId}::uuid,${viewerId}::uuid,${section},${category??null}) as allowed`;
  return row?.allowed===true;
}
export async function requireVisible(ownerId:string,viewerId:string|null,section:SocialSection,category?:string) {
  if(!await canView(ownerId,viewerId,section,category))throw new AppError(404,'This content is private or unavailable.');
}
export async function profileVisibility(ownerId:string,viewerId:string|null,category='screen') {
  const rows=await getSql()`select s, social_visible(${ownerId}::uuid,${viewerId}::uuid,s,case when s='details' then null else ${category} end) as allowed from unnest(array['details','collection','activity','progress','favourites','ratings','presence','reactions','insights']) s`;
  return Object.fromEntries(rows.map((r:{s:string;allowed:boolean})=>[r.s,r.allowed])) as Record<SocialSection,boolean>;
}
