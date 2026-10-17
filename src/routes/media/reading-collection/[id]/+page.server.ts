import {error} from '@sveltejs/kit';
import * as v from 'valibot';
import {and,eq} from 'drizzle-orm';
import {getDb} from '$lib/server/db';
import {readingGroups,readingGroupMembers,readingWorks} from '$lib/server/db/schema';
import {getFeatureConfig} from '$lib/server/features';
import {requireEnabledCategory} from '$lib/server/experimental';
import type {PageServerLoad} from './$types';
export const load:PageServerLoad=async({locals,params,depends})=>{
 if(!locals.user)error(401,'Sign in to browse reading collections.');
 if(!v.is(v.pipe(v.string(),v.uuid()),params.id))error(400,'Choose a reading collection.');
 depends('coast:reading');depends('coast:tracking');
 const [group]=await getDb().select().from(readingGroups).where(eq(readingGroups.id,params.id));
 if(!group)error(404,'Reading collection not found.');
 requireEnabledCategory(await getFeatureConfig(locals.user.id),group.kind);
 const [cover]=await getDb().select({url:readingWorks.coverUrl}).from(readingGroupMembers)
  .innerJoin(readingWorks,eq(readingWorks.id,readingGroupMembers.workId))
  .where(and(eq(readingGroupMembers.groupId,group.id),eq(readingWorks.kind,group.kind))).orderBy(readingWorks.id).limit(1);
 return {group,cover:cover?.url??null};
};
