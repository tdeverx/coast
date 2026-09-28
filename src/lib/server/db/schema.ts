import type { ScreenKind, MediaRelationship } from '$lib/media/model';
import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  boolean,
  date,
  real,
  primaryKey,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { jsonb } from './jsonb';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
export type MediaKind = ScreenKind;
export type JsonObject = Record<string, unknown>;
export type ProfileSettings = {
  displayName?: string;
  bio?: string;
  avatar?: string | null;
  backgroundMediaId?: string | null;
  backgroundPosition?: number;
  featuredMediaId?: string | null;
  featuredNote?: string;
  period?: 'month' | 'year' | 'all';
  favouriteKind?: 'all' | 'movie' | 'show';
  pinnedFavourites?: string[];
  favouriteOrder?: string[];
};
export type UserSettings = {
  profile?: ProfileSettings;
  syncConflictWinner?: string;
  fullWidth?: boolean;
  originalTitles?: boolean;
  region?: string;
  theme?: 'dark' | 'light' | 'system';
  subtitleLanguages?: string[];
  subtitlesAlways?: boolean;
  subtitlePrompt?: boolean;
  notificationsSilenced?: boolean;
  notificationLevel?: 'silent' | 'normal' | 'persistent';
};

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    email: text('email'),
    role: text('role').$type<'admin' | 'user'>().notNull().default('user'),
    settings: jsonb('settings').$type<UserSettings>().notNull().default({}),
    disabled: boolean('disabled').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('users_username_unique').on(sql`lower(${t.username})`),
    check('users_role_check', sql`${t.role} in ('admin', 'user')`),
  ]
);
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    previousTokenHash: text('previous_token_hash'),
    previousValidUntil: timestamp('previous_valid_until', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)]
);
export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').$type<MediaKind>().notNull(),
    title: text('title').notNull(),
    originalTitle: text('original_title'),
    overview: text('overview'),
    posterPath: text('poster_path'),
    backdropPath: text('backdrop_path'),
    releaseDate: date('release_date'),
    year: integer('year'),
    runtimeMinutes: integer('runtime_minutes'),
    genres: text('genres').array().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('media_title_idx').on(t.title),
    index('media_kind_idx').on(t.kind),
    check('media_kind_check', sql`${t.kind} in ('movie','show','season','episode','collection')`),
  ]
);
export const movies = pgTable('movies', {
  mediaId: uuid('media_id')
    .primaryKey()
    .references(() => media.id, { onDelete: 'cascade' }),
  tagline: text('tagline'),
  status: text('status'),
});
export const shows = pgTable('shows', {
  mediaId: uuid('media_id')
    .primaryKey()
    .references(() => media.id, { onDelete: 'cascade' }),
  status: text('status'),
  network: text('network'),
});
export const seasons = pgTable(
  'seasons',
  {
    mediaId: uuid('media_id')
      .primaryKey()
      .references(() => media.id, { onDelete: 'cascade' }),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.mediaId, { onDelete: 'cascade' }),
    seasonNumber: integer('season_number').notNull(),
  },
  (t) => [uniqueIndex('seasons_show_number_unique').on(t.showId, t.seasonNumber)]
);
export const episodes = pgTable(
  'episodes',
  {
    mediaId: uuid('media_id')
      .primaryKey()
      .references(() => media.id, { onDelete: 'cascade' }),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.mediaId, { onDelete: 'cascade' }),
    seasonId: uuid('season_id').references(() => seasons.mediaId, { onDelete: 'set null' }),
    seasonNumber: integer('season_number').notNull(),
    episodeNumber: integer('episode_number').notNull(),
    isSpecial: boolean('is_special').notNull().default(false),
    runtimeMinutes: integer('runtime_minutes'),
  },
  (t) => [
    uniqueIndex('episodes_show_number_unique').on(t.showId, t.seasonNumber, t.episodeNumber),
    index('episodes_season_idx').on(t.seasonId),
  ]
);
export const episodeOrders = pgTable('episode_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  showId: uuid('show_id')
    .notNull()
    .references(() => shows.mediaId, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  provider: text('provider'),
  externalId: text('external_id'),
  isDefault: boolean('is_default').notNull().default(false),
});
export const episodeOrderItems = pgTable(
  'episode_order_items',
  {
    orderId: uuid('order_id')
      .notNull()
      .references(() => episodeOrders.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.mediaId, { onDelete: 'cascade' }),
    seasonNumber: integer('season_number').notNull(),
    episodeNumber: integer('episode_number').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orderId, t.episodeId] }),
    uniqueIndex('episode_order_position_unique').on(t.orderId, t.position),
  ]
);
export const mediaRelationships = pgTable(
  'media_relationships',
  {
    parentId: uuid('parent_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    childId: uuid('child_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<MediaRelationship>().notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.parentId, t.childId, t.kind] }),
    check('media_relationship_not_self', sql`${t.parentId} <> ${t.childId}`),
  ]
);
export const externalIds = pgTable(
  'external_ids',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    mediaKind: text('media_kind').$type<MediaKind>().notNull(),
  },
  (t) => [
    uniqueIndex('external_ids_identity_unique').on(t.provider, t.externalId, t.mediaKind),
    index('external_ids_media_idx').on(t.mediaId),
  ]
);

export const providerInstances = pgTable('provider_instances', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').$type<'jellyfin' | 'trakt' | 'tmdb' | 'seerr'>().notNull(),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  serverIdentity: text('server_identity'),
  linkedMediaInstanceId: uuid('linked_media_instance_id'),
  credentials: text('credentials'),
  settings: jsonb('settings').$type<JsonObject>().notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: createdAt(),
});
export const providerConnections = pgTable(
  'provider_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => providerInstances.id, { onDelete: 'cascade' }),
    externalUserId: text('external_user_id'),
    username: text('username'),
    credentials: text('credentials'),
    settings: jsonb('settings').$type<JsonObject>().notNull().default({}),
    status: text('status')
      .$type<'connected' | 'disconnected' | 'error'>()
      .notNull()
      .default('connected'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('connections_user_instance_unique').on(t.userId, t.instanceId)]
);
export const providerItems = pgTable(
  'provider_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => providerInstances.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    kind: text('kind').$type<MediaKind>().notNull(),
    snapshot: jsonb('snapshot').$type<JsonObject>().notNull().default({}),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('provider_items_identity_unique').on(t.instanceId, t.externalId),
    index('provider_items_media_idx').on(t.mediaId),
  ]
);
const metadataColumns = () => ({
  title: text('title'),
  originalTitle: text('original_title'),
  overview: text('overview'),
  posterPath: text('poster_path'),
  backdropPath: text('backdrop_path'),
  releaseDate: date('release_date'),
  runtimeMinutes: integer('runtime_minutes'),
  genres: text('genres').array(),
  certificate: text('certificate'),
});
export const metadataSnapshots = pgTable(
  'metadata_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    instanceId: uuid('instance_id').references(() => providerInstances.id, { onDelete: 'cascade' }),
    ...metadataColumns(),
    language: text('language').notNull().default('en'),
    region: text('region').notNull().default('GB'),
    raw: jsonb('raw').$type<JsonObject>().notNull().default({}),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('metadata_snapshots_media_idx').on(t.mediaId),
    uniqueIndex('metadata_snapshot_source_unique').on(
      t.mediaId,
      t.provider,
      sql`coalesce(${t.instanceId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.language,
      t.region
    ),
  ]
);
export const metadataOverrides = pgTable('metadata_overrides', {
  mediaId: uuid('media_id')
    .primaryKey()
    .references(() => media.id, { onDelete: 'cascade' }),
  ...metadataColumns(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});
export type MetadataField =
  | 'title'
  | 'originalTitle'
  | 'overview'
  | 'posterPath'
  | 'backdropPath'
  | 'releaseDate'
  | 'runtimeMinutes'
  | 'genres'
  | 'certificate';
export const metadataLocks = pgTable(
  'metadata_locks',
  {
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    field: text('field').$type<MetadataField>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.mediaId, t.field] })]
);
export const userMetadataPreferences = pgTable(
  'user_metadata_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    title: text('title'),
    posterPath: text('poster_path'),
    backdropPath: text('backdrop_path'),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.mediaId] })]
);

export type TrackingAction =
  | 'watch'
  | 'unwatch'
  | 'progress'
  | 'drop'
  | 'restore'
  | 'watchlist'
  | 'favourite'
  | 'collect';
export const trackingEvents = pgTable(
  'tracking_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    action: text('action').$type<TrackingAction>().notNull(),
    source: text('source').notNull().default('coast'),
    sourceEventId: text('source_event_id'),
    sequence: jsonb('sequence').$type<{
      kind: 'collection' | 'playlist';
      id: string;
      entryId: string;
    }>(),
    editionId: text('edition_id'),
    value: boolean('value'),
    positionSeconds: real('position_seconds'),
    durationSeconds: real('duration_seconds'),
    rewatch: boolean('rewatch').notNull().default(false),
    occurredAtKnown: boolean('occurred_at_known').notNull().default(true),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    applied: boolean('applied').notNull().default(true),
    reviewReason: text('review_reason'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewDecision: text('review_decision').$type<'accepted' | 'ignored'>(),
  },
  (t) => [
    uniqueIndex('tracking_source_event_unique').on(t.userId, t.source, t.sourceEventId),
    index('tracking_history_idx').on(t.userId, t.mediaId, t.occurredAt),
  ]
);
/** Imported event identities explicitly removed by the user, without retaining the watch record. */
export const removedTrackingSources = pgTable(
  'removed_tracking_sources',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    sourceEventId: text('source_event_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.source, t.sourceEventId] })]
);
export const trackingState = pgTable(
  'tracking_state',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    watched: boolean('watched').notNull().default(false),
    playCount: integer('play_count').notNull().default(0),
    positionSeconds: real('position_seconds').notNull().default(0),
    durationSeconds: real('duration_seconds'),
    watchlist: boolean('watchlist').notNull().default(false),
    favourite: boolean('favourite').notNull().default(false),
    collected: boolean('collected').notNull().default(false),
    dropped: boolean('dropped').notNull().default(false),
    completedEpisodes: integer('completed_episodes').notNull().default(0),
    totalEpisodes: integer('total_episodes').notNull().default(0),
    lastWatchedAt: timestamp('last_watched_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.mediaId] }),
    index('tracking_state_recent_idx').on(t.userId, t.updatedAt),
    check('tracking_nonnegative', sql`${t.playCount} >= 0 and ${t.positionSeconds} >= 0`),
  ]
);
export const upNext = pgTable(
  'up_next',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    addedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.mediaId] })]
);

export const rewatches = pgTable(
  'rewatches',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.mediaId] })]
);

export const editionProgress = pgTable(
  'edition_progress',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    editionId: text('edition_id').notNull(),
    positionSeconds: real('position_seconds').notNull().default(0),
    durationSeconds: real('duration_seconds'),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.mediaId, t.editionId] })]
);
export const ratings = pgTable(
  'ratings',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    value: real('value').notNull(),
    source: text('source').notNull().default('coast'),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.mediaId] }),
    check(
      'ratings_half_stars',
      sql`${t.value} between 0.5 and 5 and ${t.value} * 2 = floor(${t.value} * 2)`
    ),
  ]
);
export const lists = pgTable(
  'lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    playlist: boolean('playlist').notNull().default(false),
    playbackStartedAt: timestamp('playback_started_at', { withTimezone: true }),
    source: text('source').notNull().default('coast'),
    externalId: text('external_id'),
    sourceConnectionId: uuid('source_connection_id').references(() => providerConnections.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('lists_user_idx').on(t.userId),
    uniqueIndex('lists_source_identity_unique').on(t.userId, t.source, t.externalId),
  ]
);
export const listItems = pgTable(
  'list_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listId: uuid('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('list_items_position_idx').on(t.listId, t.position)]
);

export const availability = pgTable(
  'availability',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'cascade' }),
    providerItemId: uuid('provider_item_id')
      .notNull()
      .references(() => providerItems.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull().default('default'),
    edition: text('edition'),
    container: text('container'),
    videoCodec: text('video_codec'),
    audioCodec: text('audio_codec'),
    bitrate: bigint('bitrate', { mode: 'number' }),
    width: integer('width'),
    height: integer('height'),
    durationSeconds: real('duration_seconds'),
    state: text('state')
      .$type<'available' | 'unavailable' | 'unknown'>()
      .notNull()
      .default('available'),
    source: jsonb('source').$type<JsonObject>().notNull().default({}),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
    scanId: uuid('scan_id'),
  },
  (t) => [
    uniqueIndex('availability_source_unique').on(
      t.userId,
      t.connectionId,
      t.providerItemId,
      t.sourceId
    ),
    index('availability_user_media_idx').on(t.userId, t.mediaId),
  ]
);
export const outboxActions = pgTable(
  'outbox_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id').references(() => providerConnections.id, {
      onDelete: 'set null',
    }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<JsonObject>().notNull(),
    compactionKey: text('compaction_key'),
    state: text('state')
      .$type<'pending' | 'running' | 'failed' | 'succeeded' | 'cancelled'>()
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('outbox_pending_idx').on(t.state, t.nextAttemptAt),
    index('outbox_connection_order_idx').on(t.userId, t.connectionId, t.createdAt),
  ]
);
export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').references(() => providerConnections.id, {
    onDelete: 'cascade',
  }),
  kind: text('kind').notNull(),
  state: text('state')
    .$type<'pending' | 'running' | 'failed' | 'succeeded' | 'cancelled'>()
    .notNull()
    .default('pending'),
  payload: jsonb('payload').$type<JsonObject>().notNull().default({}),
  progress: integer('progress').notNull().default(0),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
export const syncCheckpoints = pgTable(
  'sync_checkpoints',
  {
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    cursor: text('cursor'),
    scanId: uuid('scan_id'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.kind] })]
);
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    level: text('level').$type<'silent' | 'normal' | 'persistent'>().notNull().default('normal'),
    locked: boolean('locked').notNull().default(false),
    sourceKey: text('source_key'),
    readAt: timestamp('read_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_inbox_idx').on(t.userId, t.createdAt),
    uniqueIndex('notifications_source_unique').on(t.userId, t.sourceKey),
  ]
);
export const diagnostics = pgTable('diagnostics', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(),
  message: text('message').notNull(),
  detail: jsonb('detail').$type<JsonObject>().notNull().default({}),
  createdAt: createdAt(),
});
export const playbackSessions = pgTable('playback_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  mediaId: uuid('media_id')
    .notNull()
    .references(() => media.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id')
    .notNull()
    .references(() => providerConnections.id, { onDelete: 'cascade' }),
  providerItemId: uuid('provider_item_id')
    .notNull()
    .references(() => providerItems.id, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull(),
  edition: text('edition'),
  providerSessionId: text('provider_session_id'),
  sequence: jsonb('sequence').$type<{
    kind: 'collection' | 'playlist';
    id: string;
    entryId: string;
  }>(),
  delivery: text('delivery').$type<'direct' | 'hls' | 'transcode'>().notNull(),
  streamPath: text('stream_path').notNull(),
  positionSeconds: real('position_seconds').notNull().default(0),
  durationSeconds: real('duration_seconds'),
  state: text('state')
    .$type<'prepared' | 'active' | 'paused' | 'stopped'>()
    .notNull()
    .default('active'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
export const mediaRequests = pgTable(
  'media_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => providerInstances.id, { onDelete: 'cascade' }),
    externalId: text('external_id'),
    serverId: integer('server_id'),
    is4k: boolean('is_4k').notNull().default(false),
    seasons: integer('seasons').array().notNull().default([]),
    state: text('state')
      .$type<'pending' | 'approved' | 'available' | 'declined' | 'cancelled' | 'failed'>()
      .notNull()
      .default('pending'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('requests_user_idx').on(t.userId, t.createdAt),
    index('requests_destination_idx').on(t.mediaId, t.instanceId),
  ]
);

/** Last observed provider value and the Coast value agreed with that connection. */
export const syncValues = pgTable(
  'sync_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    remote: jsonb('remote').$type<JsonObject>().notNull(),
    agreed: jsonb('agreed').$type<JsonObject>(),
    conflict: boolean('conflict').notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('sync_values_identity_unique').on(t.connectionId, t.mediaId, t.category)]
);

export const syncListValues = pgTable(
  'sync_list_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'cascade' }),
    listId: uuid('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    remote: jsonb('remote').$type<JsonObject>().notNull(),
    agreed: jsonb('agreed').$type<JsonObject>(),
    conflict: boolean('conflict').notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('sync_list_values_identity_unique').on(t.connectionId, t.listId)]
);
