import {visitTasteHistory} from '#lib/recommendations/interests.server.js';
import type {MetadataSource} from '#lib/catalogue/metadata/resolve.js';
import {getSql} from '#lib/server/db/index.js';
import {assertJobLease} from '#lib/server/queue/execution.js';
import {childTasteCredits, workTasteFeatures} from './work-features.server';
import type {TasteAudienceRating} from './taste-rating-model';
import type {TasteObservation} from './taste-training';

export async function visitTasteObservations(userId:string,categories:string[],policy:MetadataSource,region:string,
  visit:(row:TasteObservation,ratingCount:number,medianRating:number|null)=>void, independentHabits=false, includeCreators=false) {
  await visitTasteHistory(userId,categories,async works=>{
    await assertJobLease(getSql());
    const audience=works.some(work=>work.rating!==null&&work.rating<3)?new Map<string,TasteAudienceRating>():undefined;
    const features=await workTasteFeatures(works.map(work=>work.id),policy,audience,region,userId,includeCreators);
    const credits=await childTasteCredits(works,features,policy);
    for(const work of works) {
      visit({work,features:features.get(work.id)??{},audience:audience?.get(work.id),credits:credits.get(work.id)},work.ratingCount,work.medianRating);
    }
  },policy,independentHabits);
}
