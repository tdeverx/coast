/** Independent administrator gates shared by navigation and read projections. */
export type MediumFeatures = { experimentalMusic: boolean; experimentalGaming: boolean; experimentalBooks: boolean; experimentalComics: boolean };
export type ExperimentalFeatures = MediumFeatures & { experimentalParties: boolean };
export type ExperimentalFeature = 'music' | 'gaming' | 'parties' | 'books' | 'comics';
const featureFields = {music:'experimentalMusic', gaming:'experimentalGaming', parties:'experimentalParties', books:'experimentalBooks', comics:'experimentalComics'} as const;
export function featureEnabled(config: ExperimentalFeatures, feature: ExperimentalFeature) {
  return config[featureFields[feature]];
}
export function categoryEnabled(config: MediumFeatures, category: string) {
  return category === 'screen' || category === 'music' && config.experimentalMusic || category === 'game' && config.experimentalGaming || category === 'book' && config.experimentalBooks || category === 'comic' && config.experimentalComics || category === 'reading' && (config.experimentalBooks || config.experimentalComics);
}
export function surfaceEnabled(config: MediumFeatures, surface: string) {
  return categoryEnabled(config, surface === 'watch' ? 'screen' : surface === 'listen' ? 'music' : surface === 'play' ? 'game' : surface === 'read' ? 'reading' : '');
}
export function mediumOptions(config: MediumFeatures, supported?: readonly string[]) {
  return [{value:'screen', label:'Watching'}, ...(config.experimentalGaming ? [{value:'game', label:'Playing'}] : []), ...(config.experimentalMusic ? [{value:'music', label:'Listening'}] : []), ...(config.experimentalBooks || config.experimentalComics ? [{value:'reading',label:'Reading'}] : [])].filter(option => !supported || supported.includes(option.value));
}
