import * as v from 'valibot';
import {eq} from 'drizzle-orm';
import {requireAdmin,type SessionUser} from '#lib/server/auth/index.js';
import {getDb} from '#lib/server/db/index.js';
import * as s from '#lib/server/db/schema.js';
import {AppError} from '#lib/server/security/errors.js';
import {changeConfig} from './configuration.server';

/** Editorial selections keep their exact identity, including seasons and episodes. */
export async function updateFeaturedHero(actor:SessionUser|null,input:unknown){
  requireAdmin(actor);
  const {mediaId,featured}=v.parse(v.object({mediaId:v.pipe(v.string(),v.uuid()),featured:v.boolean()}),input);
  if(featured){
    const [target]=await getDb().select({kind:s.media.kind}).from(s.media).where(eq(s.media.id,mediaId));
    if(!target)throw new AppError(404,'This title was not found.');
    if(!['movie','show','season','episode'].includes(target.kind))throw new AppError(400,'Choose a screen title to feature.');
  }
  const config=await changeConfig(actor,previous=>{
    const ids=previous.featuredHeroIds.filter(id=>id!==mediaId);
    if(featured){
      if(previous.featuredHeroIds.includes(mediaId))return {};
      if(ids.length>=20)throw new AppError(400,'Remove a featured title before adding another (maximum 20).');
      ids.push(mediaId);
    }
    return {featuredHeroIds:ids};
  });
  return {featuredHeroIds:config.featuredHeroIds};
}
