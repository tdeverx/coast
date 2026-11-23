import type {TasteMedium} from './taste-profile';
import {personalDimensionsFor,prepareTasteV2Catalogue,scoreTasteV2,trainTasteV2,
  type TasteV2Features,type TasteV2Observation,type TasteV2Options,type TasteV2Profile} from './taste-v2';

export type PersonalTasteFeatures = TasteV2Features;
export type PersonalTasteObservation = TasteV2Observation;
export type PersonalTasteProfile<M extends TasteMedium = TasteMedium> = TasteV2Profile<M>;
export const scorePersonalTaste = scoreTasteV2;

export function trainPersonalTaste<M extends TasteMedium>(medium:M, observations:readonly PersonalTasteObservation[], options:TasteV2Options={}) {
  return trainTasteV2(medium,observations,{...options,stage:'calibrated'});
}

export function preparePersonalCatalogue(medium:TasteMedium,features:Iterable<PersonalTasteFeatures>) {
  return prepareTasteV2Catalogue(features,personalDimensionsFor(medium));
}
