/** Finite product choices. Permissions, privacy, provider readiness and schedules remain separate. */
export const featureDefinitions = [
  ['screen', 'Films & TV', 'Browse and track films and shows.'],
  ['music', 'Music', 'Browse albums, track listens and play connected music.'],
  ['game', 'Gaming', 'Discover games and import playtime and achievements.'],
  ['book', 'Books', 'Discover books and track your reading.'],
  ['comic', 'Comics', 'Discover comics and track your reading.'],
  ['personalisation', 'Personalisation', 'Use your activity to build taste profiles and recommendations.'],
  ['social', 'Social', 'Use Friends, shared activity, reactions and recommendations. Public profiles keep their own privacy settings.'],
  ['presence', 'Presence & live activity', 'Observe and report your optional online and playing status. Administrator stream inspection is separate.'],
  ['playback', 'Playback', 'Play video and audio in Coast. Manual tracking remains available.'],
  ['reader', 'File reader', 'Open supported book and comic files. Manual reading progress remains available.'],
  ['parties', 'Parties', 'Join friends for synchronized playback or reading. Requires Social.'],
  ['planning', 'Planning & Upcoming', 'Plan media and receive reminders.'],
  ['sharing', 'Playback sharing', 'Create stream links when your administrator has granted permission.'],
  ['requests', 'Media requests', 'Request new media from connected services.'],
  ['api', 'Application API', 'Allow scoped application tokens and webhook delivery.'],
] as const;
export type Feature = typeof featureDefinitions[number][0];
export type PersonalFeature = Exclude<Feature, 'api'>;
export type FeatureChoices = Partial<Record<PersonalFeature, boolean>>;
export const administratorFeatures = ['screen','personalisation','social','presence','playback','reader','api'] as const satisfies readonly Feature[];
export type AdministratorFeature = typeof administratorFeatures[number];
export type FeaturePolicy = Partial<Record<AdministratorFeature, boolean>>;
export type FeatureValues = Record<Feature, boolean>;
export type FeatureConfiguration = {
  features?: FeaturePolicy;
  experimentalMusic: boolean; experimentalGaming: boolean;
  experimentalBooks: boolean; experimentalComics: boolean;
  experimentalParties: boolean; experimentalPlanning: boolean;
  allowPlaybackSharing: boolean; enableRequests: boolean;
};
const experimentFields = {music:'experimentalMusic',game:'experimentalGaming',book:'experimentalBooks',comic:'experimentalComics',parties:'experimentalParties',planning:'experimentalPlanning'} as const;
export type FeatureDecision = { enabled: boolean; reason: 'administrator' | 'experiment' | 'personal' | 'social' | 'playback' | null };
export function resolveFeatures(config: FeatureConfiguration, choices: FeatureChoices = {}): Record<Feature, FeatureDecision> {
  const decisions = Object.fromEntries(featureDefinitions.map(([key]) => {
    const experiment = experimentFields[key as keyof typeof experimentFields];
    const available = key === 'sharing' ? config.allowPlaybackSharing : key === 'requests' ? config.enableRequests : config.features?.[key as AdministratorFeature] !== false;
    const reason = !available ? 'administrator' : experiment && !config[experiment] ? 'experiment' : key !== 'api' && choices[key] === false ? 'personal' : null;
    return [key, {enabled: reason === null, reason}];
  })) as Record<Feature, FeatureDecision>;
  for (const key of ['presence','parties'] as const) if (decisions[key].enabled && !decisions.social.enabled) decisions[key] = {enabled:false, reason:'social'};
  if (decisions.sharing.enabled && !decisions.playback.enabled) decisions.sharing = {enabled:false, reason:'playback'};
  return decisions;
}
export function featureValues(config: FeatureConfiguration, choices?: FeatureChoices): FeatureValues {
  return Object.fromEntries(Object.entries(resolveFeatures(config, choices)).map(([key, value]) => [key, value.enabled])) as FeatureValues;
}

export function hasWithdrawnFeatures(previous:FeatureValues,next:FeatureValues) {
  return featureDefinitions.some(([key])=>previous[key]&&!next[key]);
}
