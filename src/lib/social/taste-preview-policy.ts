import type {TasteV2Medium,TasteV2Options} from './taste-v2';

export const previewModelOptions:Record<TasteV2Medium,TasteV2Options>={movie:{stage:'calibrated'},show:{stage:'calibrated'}};
// A medium may enter ordinary preview cards only for a cohort that passed the replay.
const minimumValidatedRatings: Partial<Record<TasteV2Medium,number>>={};
export function previewCardAdmitted(medium:TasteV2Medium, ratings:number) {
  const minimum=minimumValidatedRatings[medium];
  return minimum!==undefined && ratings>=minimum;
}
export const admittedPreviewMedia=Object.keys(minimumValidatedRatings) as TasteV2Medium[];
export const previewPolicyRevision=JSON.stringify([previewModelOptions,minimumValidatedRatings]);
