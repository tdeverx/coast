/** Independent administrator gates shared by navigation and read projections. */
export type MediumFeatures = { experimentalMusic: boolean; experimentalGaming: boolean };
export type ExperimentalFeatures = MediumFeatures & { experimentalParties: boolean };
export type ExperimentalFeature = 'music' | 'gaming' | 'parties';
const featureFields = {music:'experimentalMusic', gaming:'experimentalGaming', parties:'experimentalParties'} as const;
export function featureEnabled(config: ExperimentalFeatures, feature: ExperimentalFeature) {
  return config[featureFields[feature]];
}
export function categoryEnabled(config: MediumFeatures, category: string) {
  return category === 'screen' || category === 'music' && config.experimentalMusic || category === 'game' && config.experimentalGaming;
}
export function surfaceEnabled(config: MediumFeatures, surface: string) {
  return categoryEnabled(config, surface === 'watch' ? 'screen' : surface === 'listen' ? 'music' : surface === 'play' ? 'game' : '');
}
export function mediumOptions(config: MediumFeatures) {
  return [{value:'screen', label:'Watching'}, ...(config.experimentalGaming ? [{value:'game', label:'Playing'}] : []), ...(config.experimentalMusic ? [{value:'music', label:'Listening'}] : [])];
}
