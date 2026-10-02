// The reference stays aligned with the public component inventory.
export const components = [
  'AddTitle',
  'AvailabilityToggle',
  'BarChart',
  'Brand',
  'BreakdownChart',
  'Button',
  'CollectionProjectionSettings',
  'ConflictList',
  'ConnectionCard',
  'ContextMenu',
  'DetailCard',
  'Dialog',
  'EmptyState',
  'FactList',
  'Header',
  'Heading',
  'Icon',
  'IntegrationSettings',
  'JobSchedule',
  'JobsSettings',
  'ListMembershipActions',
  'MediaActions',
  'MediaActivity',
  'MediaCard',
  'MediaDetailRows',
  'MediaHero',
  'MediaPage',
  'MediaRequestMenu',
  'MenuAction',
  'MetadataEditor',
  'MetricGrid',
  'NotificationToasts',
  'Pagination',
  'PersistentPlayer',
  'PlaybackTimeline',
  'PresentationActions',
  'ProfileEditor',
  'ProfileFeatureEditor',
  'ProfileRecap',
  'ProgressChart',
  'ProviderAutomation',
  'QueueList',
  'Rating',
  'RelationshipActions',
  'RequestDialog',
  'RecommendAction',
  'ReactionActions',
  'RowFeedback',
  'RowFilter',
  'RowStyleMenu',
  'SegmentedControl',
  'SequenceControl',
  'Shelf',
  'SocialControls',
  'SyncedControls',
] as const;

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
