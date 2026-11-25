/** Finite product choices. Permissions, privacy, provider readiness and schedules remain separate. */
export const featureDefinitions = [
  ['screen', 'Films & TV', 'Browse and track films and shows.'],
  ['music', 'Music', 'Browse albums, track listens and play connected music.'],
  ['game', 'Gaming', 'Discover games and import playtime and achievements.'],
  ['book', 'Books', 'Discover books and track your reading.'],
  ['comic', 'Comics', 'Discover comics and track your reading.'],
  ['personalisation', 'Personalisation', 'Use your activity to build taste profiles and recommendations.'],
  ['cardLayouts', 'Media card layouts', 'Personalise the artwork, badges, text and controls on your media cards.'],
  ['social', 'Social', 'Use Friends, shared activity, reactions and recommendations. Public profiles keep their own privacy settings.'],
  ['presence', 'Presence & live activity', 'Observe and report your optional online and playing status. Administrator stream inspection is separate.'],
  ['playback', 'Playback', 'Play video and audio in Coast. Manual tracking remains available.'],
  ['reader', 'File reader', 'Open supported book and comic files. Manual reading progress remains available.'],
  ['parties', 'Parties', 'Join friends for synchronized playback or reading. Requires Social.'],
  ['planning', 'Planning & Upcoming', 'Plan media and receive reminders.'],
  ['sharing', 'Playback sharing', 'Create stream links when your administrator has granted permission.'],
  ['requests', 'Media requests', 'Request new media from connected services.'],
  ['richToasts', 'Rich toasts', 'Show notifications with glass, artwork and stacked edges.'],
  ['cardTasteScores', 'Taste matches on cards', 'Show personal match scores on media cards. Requires Personalisation.'],
  ['settingsSidebar', 'Settings sidebar', 'Open the redesigned Settings over the current page.'],
  ['api', 'Application API', 'Allow scoped application tokens and webhook delivery.'],
] as const;
export type Feature = typeof featureDefinitions[number][0];
export type PersonalFeature = Feature;
export type FeaturePermissions = Partial<Record<Feature, boolean>>;
export type FeatureChoices = Partial<Record<PersonalFeature, boolean>>;
export const administratorFeatures = ['screen','personalisation','cardLayouts','social','presence','playback','reader','api'] as const satisfies readonly Feature[];
export type AdministratorFeature = typeof administratorFeatures[number];
export type FeaturePolicy = Partial<Record<AdministratorFeature, boolean>>;
export function featurePolicyEnabled(policy: FeaturePolicy | undefined, key: AdministratorFeature) {
  return key === 'cardLayouts' ? policy?.[key] === true : policy?.[key] !== false;
}
export type FeatureValues = Record<Feature, boolean>;
export type FeatureConfiguration = {
  features?: FeaturePolicy;
  experimentalMusic: boolean; experimentalGaming: boolean;
  experimentalBooks: boolean; experimentalComics: boolean;
  experimentalParties: boolean; experimentalPlanning: boolean;
  experimentalRichToasts?: boolean; experimentalCardTasteScores?: boolean;
  allowPlaybackSharing: boolean; enableRequests: boolean;
};
const experimentFields = {
  music: 'experimentalMusic', game: 'experimentalGaming', book: 'experimentalBooks', comic: 'experimentalComics',
  parties: 'experimentalParties', planning: 'experimentalPlanning',
  richToasts: 'experimentalRichToasts', cardTasteScores: 'experimentalCardTasteScores',
} as const;
export const experimentalFeatures = [...Object.keys(experimentFields), 'settingsSidebar'] as readonly Feature[];

export function featureGranted(config: FeatureConfiguration, key: Feature, permissions?: FeaturePermissions, legacySharing = true) {
  if (permissions?.[key] !== undefined) return permissions[key];
  if (key === 'settingsSidebar') return false;
  const experiment = experimentFields[key as keyof typeof experimentFields];
  if (experiment) return config[experiment] === true;
  if (key === 'sharing') return config.allowPlaybackSharing && legacySharing;
  if (key === 'requests') return config.enableRequests;
  return featurePolicyEnabled(config.features, key as AdministratorFeature);
}

export type FeatureDecision = { enabled: boolean; reason: 'administrator' | 'experiment' | 'personal' | 'social' | 'playback' | 'personalisation' | null };
export function resolveFeatures(config: FeatureConfiguration, choices: FeatureChoices = {}, permissions?: FeaturePermissions, legacySharing = true): Record<Feature, FeatureDecision> {
  const decisions = Object.fromEntries(featureDefinitions.map(([key]) => {
    const granted = featureGranted(config, key, permissions, legacySharing);
    const reason = !granted ? (experimentalFeatures.includes(key) ? 'experiment' : 'administrator')
      : choices[key] === false ? 'personal' : null;
    return [key, {enabled: reason === null, reason}];
  })) as Record<Feature, FeatureDecision>;
  for (const key of ['presence','parties'] as const) if (decisions[key].enabled && !decisions.social.enabled) decisions[key] = {enabled:false, reason:'social'};
  if (decisions.sharing.enabled && !decisions.playback.enabled) decisions.sharing = {enabled:false, reason:'playback'};
  if (decisions.cardTasteScores.enabled && !decisions.personalisation.enabled) decisions.cardTasteScores = {enabled:false, reason:'personalisation'};
  return decisions;
}
export function featureValues(config: FeatureConfiguration, choices?: FeatureChoices, permissions?: FeaturePermissions, legacySharing?: boolean): FeatureValues {
  return Object.fromEntries(Object.entries(resolveFeatures(config, choices, permissions, legacySharing)).map(([key, value]) => [key, value.enabled])) as FeatureValues;
}

export function hasWithdrawnFeatures(previous:FeatureValues,next:FeatureValues) {
  // Card layouts have no background work or live sessions to reconcile.
  return featureDefinitions.some(([key])=>!['cardLayouts','settingsSidebar','richToasts','cardTasteScores'].includes(key)&&previous[key]&&!next[key]);
}
