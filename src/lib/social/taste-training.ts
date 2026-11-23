import {createTasteAccumulator, prepareTasteReference, type TasteFeatures, type TasteMedium, type TasteWorkEvidence} from './taste-profile';
import {createTasteRatingTrainer, negativeRatingWeight, type TasteAudienceRating} from './taste-rating-model';
import {createTasteSelectionTrainer} from './taste-selection';
import {createCreatorTrainer} from './taste-creators';

export type TasteObservation = {
  work: TasteWorkEvidence & {id:string; kind:string; medium:TasteMedium; chosen:boolean};
  features: TasteFeatures;
  audience?: TasteAudienceRating;
  credits?: {features:TasteFeatures;rating:number}[];
};

/** Used by both the background job and held-out evaluation. Each observation represents one canonical work. */
export function trainTasteMedium(medium:TasteMedium, ratingCount:number, medianRating:number|null, asOf=Date.now()) {
  const history=createTasteAccumulator({count:ratingCount,median:medianRating},asOf);
  const ratings=createTasteRatingTrainer(ratingCount);
  const selection=createTasteSelectionTrainer(medium);
  const creators=createCreatorTrainer();
  return {
    selection,
    add(observation:TasteObservation) {
      const {work,features,audience,credits}=observation;
      creators.add(observation);
      const negativeWeight=negativeRatingWeight(work.rating,audience);
      history.add(work,features,negativeWeight);
      if(credits?.length)history.addScopedRatings(credits);
      ratings.add(work.rating,features,negativeWeight,work.ratingReliability);
      if(work.chosen&&(medium!=='music'||work.kind==='album'))selection.addHistory(features,work);
    },
    async finish() {
      const profile=history.snapshot();
      const reference=prepareTasteReference(profile,await ratings.fit(),history.returnWeights());
      const preferences=creators.finish(reference);
      if(preferences)reference.creators=preferences;
      const rules=selection.prepare(reference);
      if(rules)reference.selection=rules;
      return {profile,reference};
    },
  };
}
