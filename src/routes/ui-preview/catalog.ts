import manifest from '#lib/ui/component-manifest.json';
import { compositions } from './reference';
export { manifest };
export const components = Object.keys(manifest) as (keyof typeof manifest)[];

export const referenceSections = [
  { value: 'typography', label: 'Typography' },
  { value: 'colors', label: 'Colors' },
  { value: 'materials', label: 'Materials' },
  { value: 'charts', label: 'Charts' },
  { value: 'elements', label: 'Elements' },
  { value: 'components', label: 'Components' },
  { value: 'compositions', label: 'Compositions' },
];

// Small controls, content primitives and charts used to compose larger components.
export const elements = [
  'Avatar', 'ChoiceGroup', 'Field', 'FormActions', 'Brand', 'Button',
  'ActivityHeader', 'ProgressBar', 'IdentityCard', 'DetailCard', 'EmptyState', 'FactList', 'Heading', 'Icon',
  'MetricGrid', 'Toast', 'OperationProgress', 'SettingsRow',
  'Pagination', 'PlaybackTimeline', 'Rating', 'TextLink',
  'RowFilter', 'RowStyleMenu', 'SegmentedControl',
] as const satisfies readonly (typeof components[number])[];

export const composedComponents = components.filter(name => !elements.some(element => element === name));

export const referenceEntries = [
  ...components.map(id => ({id, title: id.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,letter=>letter.toUpperCase()), sources: [manifest[id].path], elements: manifest[id].elements, usedBy: manifest[id].usedBy, dynamicComposition: manifest[id].dynamicComposition})),
  ...compositions.map(item => ({id: item.id, title: item.title, sources: item.sources, elements: [] as string[], usedBy: [] as string[], dynamicComposition: false})),
];

export function referenceSection(value: string | null) {
  return referenceSections.find(section => section.value === value)?.value ?? 'typography';
}
