import usage from './usage.json';
import manifest from '#lib/ui/component-manifest.json';
import { referenceRecipes, scenarios, scenarioLabel, type ReferenceCategory } from './reference';
const publicComponents = Object.keys(manifest) as (keyof typeof manifest)[];

export const referenceSections = [
  { value: 'typography', label: 'Typography' },
  { value: 'colors', label: 'Colors' },
  { value: 'materials', label: 'Materials' },
  { value: 'charts', label: 'Charts' },
  { value: 'elements', label: 'Elements' },
  { value: 'components', label: 'Components' },
  { value: 'compositions', label: 'Compositions' },
  { value: 'menus', label: 'Menus' },
];

// Classify the thing being previewed independently of how its example is rendered.
const publicCategories = {
  AccountFields: 'components',
  ActivityHeader: 'components',
  Avatar: 'elements',
  AvatarPicker: 'components',
  Brand: 'elements',
  Button: 'elements',
  ChoiceGroup: 'components',
  CollectionProjectionSettings: 'compositions',
  ConflictList: 'compositions',
  ConnectionCard: 'compositions',
  DetailCard: 'components',
  DetailOverlay: 'components',
  Dialog: 'components',
  EmptyState: 'components',
  FactList: 'components',
  Field: 'elements',
  FormActions: 'components',
  FriendRoster: 'compositions',
  FriendsPanel: 'compositions',
  Header: 'compositions',
  Heading: 'components',
  Icon: 'elements',
  IdentityCard: 'components',
  IntegrationSettings: 'compositions',
  JobSchedule: 'components',
  JobsSettings: 'compositions',
  MediaActivity: 'components',
  MediaCard: 'components',
  MediaDetailRows: 'compositions',
  MediaDetails: 'compositions',
  MediaHero: 'compositions',
  MediaPage: 'compositions',
  MetadataEditor: 'compositions',
  MetricGrid: 'components',
  NotificationInbox: 'compositions',
  NotificationToasts: 'compositions',
  OperationProgress: 'elements',
  Pagination: 'components',
  PartyCard: 'components',
  PartyMenu: 'components',
  PersistentPlayer: 'compositions',
  PlaybackTimeline: 'components',
  ProfileEditor: 'compositions',
  ProfileRecap: 'components',
  ProgressBar: 'elements',
  ProgressiveBlur: 'elements',
  ProviderAutomation: 'compositions',
  QueueList: 'compositions',
  Rating: 'elements',
  ReactionActions: 'components',
  RecommendAction: 'components',
  RequestDialog: 'compositions',
  RowFilter: 'components',
  RowStyleMenu: 'components',
  SegmentedControl: 'elements',
  SettingsRow: 'components',
  Shelf: 'compositions',
  SocialControls: 'components',
  StreamsPanel: 'compositions',
  SyncedControls: 'compositions',
  TextLink: 'elements',
  Toast: 'components',
  Toggle: 'elements',
  WorkActions: 'components',
  WorkListActions: 'components',
  WorkMenu: 'components',
} satisfies Record<keyof typeof manifest, ReferenceCategory>;

type ComponentName = keyof typeof manifest;
type VariantPlacement = { owner?: ComponentName; prefix?: string; states?: Record<string, ComponentName> };
const variants: Readonly<Record<string, VariantPlacement>> = {
  'settings.connection': {owner:'ConnectionCard'},
  'settings.projection': {owner:'CollectionProjectionSettings'},
  'settings.integration': {owner:'IntegrationSettings'},
  'settings.automation': {owner:'ProviderAutomation'},
  'account.invites': {owner:'FriendsPanel'},
  'editor.toggle': {owner:'Toggle'},
  'editor.value': {owner:'Field'},
  'onboarding.services': {states:{'profile-fields':'ProfileEditor'}},
  'onboarding.panels': {owner:'SegmentedControl',prefix:'Onboarding transition'},
  'onboarding.import': {owner:'OperationProgress', prefix:'Onboarding'},
  'catalogue.cards': {owner:'MediaCard'},
  'catalogue.rows': {owner:'Shelf'},
  'catalogue.progress': {owner:'Shelf', prefix:'Mixed-media progress'},
  'catalogue.details': {owner:'MediaDetails'},
  'media.details': {owner:'DetailOverlay'},
  'settings.progress': {owner:'OperationProgress', prefix:'Sync'},
  'settings.rows': {owner:'SettingsRow', prefix:'Preferences form'},
  'foundation.controls': {owner:'Button'},
  'app.shell': {owner:'Header', states:{error:'EmptyState'}},
  'ui.native': {states:{inputs:'Field', notices:'Toast'}},
};

const specimens = [
  ...publicComponents.map(id => ({id, category: publicCategories[id], title: id.replace(/([a-z])([A-Z])/g,'$1 $2'), sources: [manifest[id].path], elements: manifest[id].elements, usedBy: manifest[id].usedBy, dynamicComposition: manifest[id].dynamicComposition})),
  ...referenceRecipes.map(item => ({id: item.id, category: item.category, title: item.title, sources: item.sources, elements: [] as string[], usedBy: [] as string[], dynamicComposition: false})),
];

type ExampleState = {id:string; label:string; reference:string; scenario:string};
const mounts: Readonly<Record<string, number>> = usage.mounts;
function countUses(specimen: typeof specimens[number]) {
  if (specimen.id === 'ui.native') return usage.nativeExamples;
  if (['pages.browse','sharing.landing','admin.invites','admin.member'].includes(specimen.id))
    return specimen.sources.reduce((sum, source) => sum + (mounts[source] ?? 0), 0);
  const path = specimen.sources[0];
  // These owners have a second implementation behind the settings-sidebar permission.
  const sidebar = path.replace('src/lib/ui/components/', 'src/lib/settings/redesign/');
  return (mounts[path] ?? 0) + (sidebar !== path ? mounts[sidebar] ?? 0 : 0);
}
const entries = specimens.map(specimen => ({...specimen, uses: countUses(specimen), sources:[...specimen.sources], states:[] as ExampleState[]}));
const byId = new Map(entries.map(entry => [entry.id, entry]));
for (const specimen of specimens) {
  if (specimen.id === 'SyncedControls') continue;
  const placement = variants[specimen.id];
  for (const scenario of scenarios(specimen.id)) {
    // The native skeleton fixture is the same empty, busy Shelf as the loading state.
    if (specimen.id === 'ui.native' && scenario === 'skeletons') continue;
    const owner = byId.get(placement?.states?.[scenario] ?? placement?.owner ?? specimen.id)!;
    const shared = owner.id !== specimen.id;
    const label = specimen.id === 'app.shell' && scenario === 'error' ? 'Page not found' : scenarioLabel(scenario);
    owner.states.push({
      id: shared ? specimen.id + ':' + scenario : scenario,
      label: placement?.prefix ? placement.prefix + ' · ' + label : label,
      reference:specimen.id, scenario,
    });
    if (shared) for (const source of specimen.sources) if (!owner.sources.includes(source)) owner.sources.push(source);
  }
}
export const referenceEntries = entries.filter(entry => entry.states.length);

export function resolveReference(id: string | null, requested?: string | null) {
  if (!id) return;
  if (id === 'SyncedControls') { id = 'FriendsPanel'; requested = 'active-party'; }
  if (id === 'ui.native' && requested === 'skeletons') {
    id = 'catalogue.rows';
    requested = 'loading';
  }
  const placement = variants[id];
  const owner = byId.get((requested && placement?.states?.[requested]) || placement?.owner || id);
  if (!owner) return;
  const selected = owner.states.find(state => state.reference === id && state.scenario === requested)
    ?? owner.states.find(state => state.id === requested)
    ?? owner.states.find(state => state.reference === id)
    ?? owner.states[0];
  return {entry:owner, state:selected};
}

export function referenceHref(id: string) {
  const result = resolveReference(id);
  if (!result) throw new Error(`Unknown UI reference: ${id}`);
  const query = new URLSearchParams({section:result.entry.category, component:result.entry.id});
  if (id !== result.entry.id) query.set('scenario', result.state.id);
  return `/ui-preview?${query}`;
}

export function referenceSection(value: string | null, item?: string | null) {
  if (item && (value === null || value === 'elements' || value === 'components' || value === 'compositions')) {
    const category = resolveReference(item)?.entry.category;
    if (category) return category;
  }
  if (value === null) return 'elements';
  return referenceSections.find(section => section.value === value)?.value ?? 'typography';
}
