import type { MenuConditions } from '#lib/ui/controls/menu-preview.js';
import { libraryTitles, type LibrarySurface } from '#lib/library.js';

type MenuExample = {
  value: string;
  label: string;
  approval: 'approved' | 'unapproved';
} & (
  | { component: string; scenario: string }
  | { filters: 'library' | 'rows'; medium: LibrarySurface | 'all' }
);
type MenuEntry = { value: string; label: string; inline: string; wrappers?: readonly string[]; examples: MenuExample[] };

const mediaExamples = [
  ['episode', 'Episode'], ['season', 'Season'], ['show', 'Show'], ['movie', 'Movie'], ['collection', 'Box set'],
  ['book', 'Book'], ['comic', 'Comic'], ['game', 'Game'], ['track', 'Track'], ['album', 'Album'], ['artist', 'Artist'],
  ['pending', 'Stream pending'],
] as const;
const filterExamples: MenuExample[] = (['library', 'rows'] as const).flatMap(filters =>
  (Object.keys(libraryTitles) as LibrarySurface[]).map(medium => ({
    value: `${filters}-${medium}`, label: `${filters === 'library' ? 'Library & Collection' : 'Rows'} · ${libraryTitles[medium]}`,
    filters, medium, approval: 'unapproved' as const,
  }))
);
filterExamples.push({ value: 'rows-mixed', label: 'Rows · Mixed media', filters: 'rows', medium: 'all', approval: 'unapproved' });

function menu(value: string, label: string, component: string, inline: string, variants: [string, string][] = [['default', label]]): MenuEntry {
  return {
    value, label, inline, wrappers: ({ 'active-shared': ['Active streams'], 'shared-link': ['Active streams'], notifications: ['Notifications'], 'friend-options': ['Friends'], 'party-member': ['Friends'] } as Record<string, string[]>)[value], examples: variants.map(([scenario, label]) => ({
      value: scenario, label, component, scenario, approval: 'unapproved',
    })),
  };
}

export const menuEntries: MenuEntry[] = [
  { value: 'media', label: 'Media', inline: 'Actions for ', examples: mediaExamples.map(([scenario, label]) => ({
    value: scenario, label, component: 'WorkMenu', scenario,
    approval: 'unapproved',
  })) },
  { value: 'filter', label: 'Filter', inline: 'Filters', examples: filterExamples },
  menu('list-entry', 'List entry', 'WorkMenu', 'Actions for ', [['list-entry', 'List entry']]),
  menu('quality', 'Quality', 'PersistentPlayer', 'Quality', [['controller', 'Quality']]),
  menu('subtitles', 'Subtitles', 'PersistentPlayer', 'Subtitles', [['controller', 'Subtitles']]),
  menu('volume', 'Volume', 'PersistentPlayer', 'Volume', [['controller', 'Video playback'], ['audio', 'Music playback']]),
  menu('party', 'Party', 'PartyMenu', 'Party options', [['host', 'Video · Host'], ['member', 'Video · Guest'], ['audio-host', 'Audio · Host'], ['audio-member', 'Audio · Guest'], ['reading-host', 'Reading · Host'], ['reading-member', 'Reading · Guest']]),
  menu('active-shared', 'Active shared playback', 'StreamsPanel', 'Actions for The Expanse', [['shared', 'Active shared playback']]),
  menu('shared-link', 'Shared link', 'StreamsPanel', 'Actions for The Expanse', [['links', 'Current link'], ['older-link', 'Older link']]),
  menu('friend', 'Friend', 'FriendRoster', 'Actions for ', [['accepted', 'Friend']]),
  menu('party-member', 'Party member', 'FriendsPanel', 'Actions for ', [['parties', 'Party member']]),
  menu('profile-background', 'Profile actions', 'profile.identity', 'Profile actions', [['self', 'Profile actions']]),
  menu('friend-options', 'Friend options', 'FriendsPanel', 'Friend options', [['friends', 'Friend options']]),
  menu('notifications', 'Notification options', 'NotificationInbox', 'Notification options', [['all', 'Notification options']]),
  menu('account', 'Account', 'Header', 'Account menu'),
  menu('navigation', 'Media navigation', 'Header', 'Choose action'),
  menu('row-appearance', 'Row appearance', 'RowStyleMenu', 'Preview row style', [['continue', 'Continue'], ['next', 'Next'], ['paused', 'Paused'], ['watchlist', 'Later'], ['favourites', 'Favourites'], ['finished', 'Finished']]),
  menu('integration', 'Integration', 'IntegrationSettings', 'Preview Jellyfin integration actions'),
  menu('task', 'Task schedule', 'JobSchedule', '*'),
  menu('job', 'Background job', 'QueueList', '*'),
];

type Condition = { id: keyof MenuConditions; label: string; initial: boolean };
const condition = (id: keyof MenuConditions, label: string, initial = true): Condition => ({ id, label, initial });

export function menuConditions(entry: MenuEntry, example: MenuExample): Condition[] {
  if ('filters' in example) return [
    condition('available', 'Availability filter'),
    ...(example.filters==='library'?[condition('collectionView','Collection view',false)]:[condition('collection','Collection filter')]),
    ...(example.filters === 'library' && !['listen', 'all'].includes(example.medium)
      ? [condition('status', 'Progress filter')] : []),
    ...(example.filters === 'library' && example.medium === 'watch' ? [condition('genre', 'Genre filter')] : []),
    ...(example.filters === 'library' ? [condition('source', 'Source filter', false)] : []),
  ];

  if (entry.value === 'media' || entry.value === 'list-entry') {
    const type = example.scenario;
    const screen = ['episode', 'season', 'show', 'movie', 'collection', 'pending', 'list-entry'].includes(type);
    const reading = type === 'book' || type === 'comic';
    const audio = ['track', 'album', 'artist'].includes(type);
    return [
      ...(screen || audio ? [condition('playback', 'Playback enabled')] : []),
      ...(reading ? [condition('reader', 'Reader enabled')] : []),
      ...(screen || audio || reading ? [condition('available', 'Source available', type !== 'pending')] : []),
      ...(screen ? [
        condition('pending', 'Stream pending', type === 'pending'), condition('position', 'Saved playback position'),
        condition('versions', 'Multiple versions'), condition('airDate', 'Known air or release date'),
        condition('metadataSource', 'Metadata source available'),
        condition('paused', 'Tracking paused', false), condition('rewatch', 'Rewatch active', false),
      ] : []),
      condition('presence', 'Check-ins enabled'), condition('checkIn', 'Active check-in', false), condition('manualCheckIn', 'Manual check-in', false),
      ...((reading || type==='track') ? [condition('position','Saved position')] : []),
      ...((reading || type==='game') ? [condition('paused','Tracking paused',false),condition('dropped','Hidden from Progress',false),condition('completed','Completed',false)] : []),
      ...(reading ? [condition('rewatch', 'Reread active', false)] : []),
      ...(type === 'game' ? [condition('playthrough', 'Playthrough exists')] : []),
      ...(screen && type !== 'collection' ? [
        condition('requests', 'Requests enabled'), condition('fourK', '4K destination'),
        condition('existingRequest', 'Existing request', false),
      ] : []),
      ...(['episode', 'movie', 'track', 'book', 'comic', 'pending', 'list-entry'].includes(type) ? [condition('sharing', 'Disposable links enabled')] : []),
      condition('social', 'Social features enabled'), condition('planning', 'Planning enabled'), condition('admin', 'Admin view'),
    ];
  }

  if (entry.value === 'party') return [condition('readyCheck', 'Ready check'), condition('controlPlayback', 'Guests control playback'), condition('editQueue', 'Guests edit queue'), condition('selectedControllers', 'Selected controllers', false), condition('acceptInvites', 'Allow new members')];
  if (entry.value === 'shared-link') return [condition('copyable', 'URL available to copy', example.value !== 'older-link')];
  if (entry.value === 'friend') return [condition('friendActivity', 'Activity visible'), condition('compare', 'Taste comparison available'), condition('partyInvite', 'Can invite to a party')];
  if (entry.value === 'quality') return [condition('versions', 'Multiple versions')];
  if (entry.value === 'subtitles') return [condition('subtitles', 'Subtitle tracks available')];
  if (entry.value === 'account') return [condition('presence', 'Presence enabled'),condition('libraryOnly', 'Library-only account',false),condition('requests', 'Requests enabled'),condition('planning', 'Planning enabled'),condition('admin', 'Administrator')];
  if (entry.value === 'navigation') return [condition('screen','Films & TV enabled'),condition('music','Music enabled'),condition('game','Gaming enabled'),condition('book','Books enabled'),condition('comic','Comics enabled')];
  if (entry.value === 'row-appearance')return [condition('artwork','Artwork options')];
  if (entry.value === 'integration')return [condition('integrationEnabled','Integration enabled')];
  if (entry.value === 'notifications')return [condition('unread','Unread notifications')];
  if (entry.value === 'task' || entry.value === 'job')return [condition('jobFailed','Failed job',false),condition('jobRunning','Running job',false),condition('benchmark','Benchmark job',false),condition('connectionFailure','Connection failure',false),condition('permissionFailure','Permission failure',false),condition('metadataFailure','Metadata failure',false)];
  return [];
}
