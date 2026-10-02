import manifest from '$lib/ui/component-manifest.json';
export { manifest };
export const components = Object.keys(manifest) as (keyof typeof manifest)[];

export const referenceSections = [
  { value: 'typography', label: 'Typography' },
  { value: 'colors', label: 'Colors' },
  { value: 'materials', label: 'Materials' },
  { value: 'elements', label: 'Elements' },
  { value: 'components', label: 'Components' },
];

// Small controls, content primitives and charts used to compose larger components.
export const elements = [
  'AvailabilityToggle', 'BarChart', 'Brand', 'BreakdownChart', 'Button',
  'ContextMenu', 'DetailCard', 'EmptyState', 'FactList', 'Heading', 'Icon',
  'ListMembershipActions', 'MediaRequestMenu', 'MenuAction', 'MetricGrid',
  'Pagination', 'PlaybackTimeline', 'ProgressChart', 'Rating', 'RelationshipActions',
  'RowFeedback', 'RowFilter', 'RowStyleMenu', 'SegmentedControl', 'SequenceControl',
] as const satisfies readonly (typeof components[number])[];

export const composedComponents = components.filter(name => !elements.some(element => element === name));

export function referenceSection(value: string | null) {
  return referenceSections.find(section => section.value === value)?.value ?? 'typography';
}
