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
export type WorkKind = ScreenKind | 'game' | 'album' | 'track' | 'book' | 'audiobook' | 'comic';
export type JsonObject = Record<string, unknown>;
export type ProfileSettings = {
  displayName?: string;
  bio?: string;
  avatar?: string | null;
  backgroundMediaId?: string | null;
  backgroundMode?: 'fixed' | 'activity';
  backgroundPosition?: number;
  featuredMediaId?: string | null;
  featuredNote?: string;
  period?: 'month' | 'year' | 'all';
  favouriteKind?: 'all' | 'movie' | 'show';
  pinnedFavourites?: string[];
  favouriteOrder?: string[];
};
export type UserSettings = {
  collection?: import('../../collection/preferences').CollectionPreferences;
  presenceAudience?: import('../../social/model').Audience;
  activityStatus?: import('../../social/status').StatusPreference;
  social?: import('../../social/model').SocialSettings;
  profile?: ProfileSettings;
  shareDemand?: boolean;
  allowPlaybackSharing?: boolean;
  listenThreshold?: number;
  syncConflictWinner?: string;
  fullWidth?: boolean;
  originalTitles?: boolean;
  monochromeMissing?: boolean;
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
    passwordHash: text('password_hash'),
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
export const userPresence = pgTable('user_presence', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }).notNull(),
  activeAt: timestamp('active_at', { withTimezone: true }),
});

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
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expiry_idx').on(t.expiresAt)]
);
export const apiTokens = pgTable('api_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  scopes: jsonb('scopes').$type<string[]>().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone:true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone:true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone:true }),
  windowStartedAt: timestamp('window_started_at', { withTimezone:true }).notNull().defaultNow(),
  windowRequests: integer('window_requests').notNull().default(0),
  createdAt: createdAt(),
}, t => [index('api_tokens_user_idx').on(t.userId)]);

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

/** Stable shared identity; each medium continues to own its metadata and activity. */
export const works = pgTable('works', {
  id: uuid('id').primaryKey().defaultRandom(),
  category: text('category').notNull(),
  kind: text('kind').$type<WorkKind>().notNull(),
  createdAt: createdAt(),
}, (t) => [index('works_category_kind_idx').on(t.category, t.kind)]);

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
      .references(() => works.id, { onDelete: 'cascade' }),
    childId: uuid('child_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
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
  provider: text('provider').$type<'jellyfin' | 'trakt' | 'tmdb' | 'seerr' | 'igdb' | 'steam'>().notNull(),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  serverIdentity: text('server_identity'),
  linkedMediaInstanceId: uuid('linked_media_instance_id'),
  credentials: text('credentials'),
  settings: jsonb('settings').$type<JsonObject>().notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: createdAt(),
});
export const syncAccounts = pgTable('sync_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  instanceId: uuid('instance_id').references(() => providerInstances.id, { onDelete: 'set null' }),
  provider: text('provider').notNull(),
  serverIdentity: text('server_identity').notNull(),
  externalUserId: text('external_user_id').notNull(),
  settings: jsonb('settings').$type<JsonObject>().notNull().default({}),
  baselines: jsonb('baselines').$type<JsonObject>().notNull().default({}),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('sync_accounts_identity_unique').on(t.userId, t.provider, t.serverIdentity, t.externalUserId)]);

export const providerConnections = pgTable(
  'provider_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountGeneration: uuid('account_generation').notNull().defaultRandom(),
    syncAccountId: uuid('sync_account_id').references(() => syncAccounts.id),
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
  (t) => [
    uniqueIndex('connections_user_instance_unique').on(t.userId, t.instanceId),
    index('connections_instance_status_idx').on(t.instanceId, t.status),
  ]
);

export const userIdentities = pgTable('user_identities', {
  instanceId: uuid('instance_id').notNull().references(() => providerInstances.id, { onDelete: 'cascade' }),
  externalUserId: text('external_user_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.instanceId, t.externalUserId] }),
  uniqueIndex('user_identities_user_instance_unique').on(t.userId, t.instanceId),
]);
export const providerItems = pgTable(
  'provider_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => providerInstances.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    kind: text('kind').$type<WorkKind>().notNull(),
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
      .references(() => works.id, { onDelete: 'cascade' }),
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
      .references(() => works.id, { onDelete: 'cascade' }),
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
      .references(() => works.id, { onDelete: 'cascade' }),
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
      .references(() => works.id, { onDelete: 'cascade' }),
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
    sourceAccountId: uuid('source_account_id').references(() => syncAccounts.id),
    sourceConnectionId: uuid('source_connection_id').references(() => providerConnections.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('lists_user_idx').on(t.userId),
    uniqueIndex('lists_source_identity_unique').on(t.userId, t.source, t.externalId, t.sourceAccountId),
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
      .references(() => works.id, { onDelete: 'cascade' }),
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
      .references(() => works.id, { onDelete: 'cascade' }),
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
    correlationId: uuid('correlation_id').notNull().defaultRandom(),
    id: uuid('id').primaryKey().defaultRandom(),
    accountGeneration: uuid('account_generation'),
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
    index('outbox_maintenance_idx').on(t.connectionId, t.kind, t.state, t.updatedAt),
    index('outbox_state_created_idx').on(t.state, t.createdAt),
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
    data: jsonb('data').$type<import('../../social/model').NotificationData>(),
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
}, t => [index('diagnostics_retention_idx').on(t.createdAt)]);
export const playbackSessions = pgTable('playback_sessions', {
  shareId:uuid('share_id'),
  mediaType: text('media_type').$type<'audio' | 'video'>().notNull().default('video'),
  playedSeconds: real('played_seconds').notNull().default(0),
  listenThreshold: integer('listen_threshold').notNull().default(50),
  listenRecorded: boolean('listen_recorded').notNull().default(false),
  correlationId: uuid('correlation_id').notNull().defaultRandom(),
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  mediaId: uuid('media_id')
    .notNull()
    .references(() => works.id, { onDelete: 'cascade' }),
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
    accountId: uuid('account_id').references(() => syncAccounts.id),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
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
    accountId: uuid('account_id').references(() => syncAccounts.id),
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

export const diagnosticSettingAudit = pgTable('diagnostic_setting_audit', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  previousLevel: text('previous_level').notNull(),
  nextLevel: text('next_level').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Games have their own metadata, progress units and history; screen-provider queries stay scoped.
export const games = pgTable('games', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  posterPath: text('poster_path'),
  backdropPath: text('backdrop_path'),
  overview: text('overview'),
  releaseDate: date('release_date'),
  platforms: text('platforms').array().notNull().default([]),
  genres: text('genres').array().notNull().default([]),
  developers: text('developers').array().notNull().default([]),
  publishers: text('publishers').array().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('games_title_idx').on(t.title)]);

export const gameExternalIds = pgTable('game_external_ids', {
  gameId: uuid('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  externalId: text('external_id').notNull(),
}, (t) => [
  primaryKey({ columns: [t.provider, t.externalId] }),
  index('game_external_ids_game_idx').on(t.gameId),
]);

export const gamePlaythroughs = pgTable('game_playthroughs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  gameId: uuid('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
  platform: text('platform'),
  status: text('status').$type<import('$lib/games/model').GameStatus>().notNull().default('planned'),
  progressPercent: real('progress_percent').notNull().default(0),
  repeat: boolean('repeat').notNull().default(false),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('game_playthroughs_user_game_idx').on(t.userId, t.gameId),
  check('game_playthroughs_status_check', sql`${t.status} in ('planned','in-progress','completed','paused','dropped')`),
  check('game_playthroughs_progress_check', sql`${t.progressPercent} between 0 and 100`),
  check('game_playthroughs_completion_check', sql`(${t.status} = 'completed') = (${t.completedAt} is not null)`),
]);

export const gameSessions = pgTable('game_sessions', {
  id: uuid('id').primaryKey(),
  playthroughId: uuid('playthrough_id').notNull().references(() => gamePlaythroughs.id, { onDelete: 'cascade' }),
  minutesPlayed: integer('minutes_played').notNull(),
  playedAt: timestamp('played_at', { withTimezone: true }).notNull(),
  note: text('note'),
  createdAt: createdAt(),
}, (t) => [
  index('game_sessions_playthrough_date_idx').on(t.playthroughId, t.playedAt),
  check('game_sessions_minutes_check', sql`${t.minutesPlayed} between 1 and 1440`),
]);

/** Albums/tracks are works; artists are credits and browsing preferences. */
export const musicWorks = pgTable('music_works', {
  id: uuid('id').primaryKey().references(() => works.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  kind: text('kind').$type<'album' | 'track'>().notNull(),
  artistNames: text('artist_names').array().notNull().default([]),
  releaseDate: date('release_date'),
  year: integer('year'),
  durationSeconds: real('duration_seconds'),
  overview: text('overview'),
  genres: text('genres').array().notNull().default([]),
  membershipComplete: boolean('membership_complete').notNull().default(false),
  updatedAt: updatedAt(),
});
export const musicArtists = pgTable('music_artists', {
  id: uuid('id').primaryKey().defaultRandom(),
  instanceId: uuid('instance_id').notNull().references(() => providerInstances.id, { onDelete: 'cascade' }),
  externalId: text('external_id').notNull(),
  name: text('name').notNull(),
}, (t) => [uniqueIndex('music_artists_identity_unique').on(t.instanceId, t.externalId)]);
export const musicCredits = pgTable('music_credits', {
  workId: uuid('work_id').notNull().references(() => works.id, { onDelete: 'cascade' }),
  artistId: uuid('artist_id').notNull().references(() => musicArtists.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
}, (t) => [primaryKey({ columns: [t.workId, t.artistId, t.role] })]);
export const musicArtistPreferences = pgTable('music_artist_preferences', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  artistId: uuid('artist_id').notNull().references(() => musicArtists.id, { onDelete: 'cascade' }),
  favourite: boolean('favourite').notNull().default(false),
}, (t) => [primaryKey({ columns: [t.userId, t.artistId] })]);
export const workIdentifiers = pgTable('work_identifiers', {
  workId: uuid('work_id').notNull().references(() => works.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  externalId: text('external_id').notNull(),
  kind: text('kind').$type<WorkKind>().notNull(),
}, (t) => [primaryKey({ columns: [t.provider, t.externalId, t.kind] }), index('work_identifiers_work_idx').on(t.workId)]);
export const workEditions = pgTable('work_editions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workId: uuid('work_id').notNull().references(() => works.id, { onDelete: 'cascade' }),
  instanceId: uuid('instance_id').references(() => providerInstances.id, { onDelete: 'cascade' }),
  externalId: text('external_id').notNull(),
  format: text('format'),
  metadata: jsonb('metadata').$type<JsonObject>().notNull().default({}),
}, (t) => [uniqueIndex('work_editions_identity_unique').on(t.instanceId, t.externalId)]);
export const musicListenBatches = pgTable('music_listen_batches', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  batchId: uuid('batch_id').notNull(),
  workId: uuid('work_id').notNull().references(() => works.id, { onDelete: 'cascade' }),
  tracks: uuid('tracks').array().notNull(),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.batchId] })]);
export const musicListens = pgTable('music_listens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  trackId: uuid('track_id').notNull().references(() => musicWorks.id, { onDelete: 'cascade' }),
  batchId: uuid('batch_id').notNull(),
  source: text('source').notNull().default('coast'),
  occurredAtKnown: boolean('occurred_at_known').notNull().default(true),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('music_listens_batch_unique').on(t.userId, t.trackId, t.batchId), index('music_listens_user_track_idx').on(t.userId, t.trackId)]);
export const musicProgress = pgTable('music_progress', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  trackId: uuid('track_id').notNull().references(() => musicWorks.id, { onDelete: 'cascade' }),
  playCount: integer('play_count').notNull().default(0),
  positionSeconds: real('position_seconds').notNull().default(0),
  durationSeconds: real('duration_seconds'),
  updatedAt: updatedAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.trackId] })]);
/** Intent survives unavailable mappings; only confirmed successful delivery clears it. */
export const reconciliationIntents = pgTable('reconciliation_intents', {
  connectionId: uuid('connection_id').notNull().references(() => providerConnections.id, { onDelete: 'cascade' }),
  workId: uuid('work_id').notNull().references(() => works.id, { onDelete: 'cascade' }),
  category: text('category').notNull(),
  value: jsonb('value').$type<JsonObject>().notNull(),
  version: uuid('version').notNull().defaultRandom(),
  updatedAt: updatedAt(),
}, (t) => [primaryKey({ columns: [t.connectionId, t.workId, t.category] })]);
export const collectionProjectionEntries = pgTable('collection_projection_entries', {
  accountId: uuid('account_id').notNull().references(() => syncAccounts.id, { onDelete: 'cascade' }),
  workId: uuid('work_id').notNull().references(() => works.id, { onDelete: 'cascade' }),
  attribution: text('attribution').$type<'pre-existing' | 'coast-added' | 'uncertain'>().notNull(),
  remote: jsonb('remote').$type<JsonObject>().notNull(),
  desired: boolean('desired').notNull().default(true),
  conflict: boolean('conflict').notNull().default(false),
  suppressed: boolean('suppressed').notNull().default(false),
  updatedAt: updatedAt(),
}, (t) => [primaryKey({ columns: [t.accountId, t.workId] })]);
export const collectionProjectionPreviews = pgTable('collection_projection_previews', {
  id: uuid('id').primaryKey().defaultRandom(),
  connectionId: uuid('connection_id').notNull().references(() => providerConnections.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').notNull().references(() => syncAccounts.id),
  configurationVersion: uuid('configuration_version').notNull(),
  configuration: jsonb('configuration').$type<JsonObject>().notNull(),
  snapshot: jsonb('snapshot').$type<JsonObject>().notNull(),
  approved: boolean('approved').notNull().default(false),
  createdAt: createdAt(),
}, t => [index('collection_projection_preview_expiry_idx').on(t.createdAt).where(sql`${t.approved}=false`)]);


export const friendships = pgTable('friendships', {
  id: uuid('id').primaryKey().defaultRandom(),
  userA: uuid('user_a').notNull().references(() => users.id, {onDelete:'cascade'}),
  userB: uuid('user_b').notNull().references(() => users.id, {onDelete:'cascade'}),
  requestedBy: uuid('requested_by').notNull().references(() => users.id, {onDelete:'cascade'}),
  state: text('state').notNull().default('pending'),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [uniqueIndex('friendships_pair_unique').on(t.userA,t.userB),check('friendships_pair_order',sql`${t.userA}<${t.userB}`),check('friendships_state',sql`${t.state} in ('pending','accepted','declined','cancelled','removed')`)]);
export const socialActivity = pgTable('social_activity', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id,{onDelete:'cascade'}),
  workId: uuid('work_id').notNull().references(() => works.id,{onDelete:'cascade'}),
  eventKind: text('event_kind').notNull(), section: text('section').notNull(),
  source: text('source').notNull(), sourceKey: text('source_key').notNull(),
  batchKey: text('batch_key'), dateKnown: boolean('date_known').notNull().default(true),
  occurredAt: timestamp('occurred_at', {withTimezone:true}).notNull().defaultNow(), createdAt: createdAt(),
}, t=>[uniqueIndex('social_activity_source_unique').on(t.userId,t.sourceKey),index('social_activity_feed_idx').on(t.userId,t.occurredAt,t.id)]);
export const socialReactions = pgTable('social_reactions', {
  userId: uuid('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),
  targetKind: text('target_kind').notNull(), targetId: uuid('target_id').notNull(), emoji:text('emoji').notNull(),updatedAt:updatedAt(),
},t=>[primaryKey({columns:[t.userId,t.targetKind,t.targetId]}),check('social_reaction_kind',sql`${t.targetKind} in ('work','activity')`),check('social_reaction_emoji',sql`${t.emoji} in ('❤️','😂','😮','😢','🔥')`)]);
export const socialRecommendations = pgTable('social_recommendations', {
  id:uuid('id').primaryKey().defaultRandom(), senderId:uuid('sender_id').notNull().references(()=>users.id,{onDelete:'cascade'}),
  recipientId:uuid('recipient_id').notNull().references(()=>users.id,{onDelete:'cascade'}),workId:uuid('work_id').notNull().references(()=>works.id,{onDelete:'cascade'}),
  state:text('state').notNull().default('pending'),createdAt:createdAt(),updatedAt:updatedAt(),
},t=>[uniqueIndex('social_recommendation_pending_unique').on(t.senderId,t.recipientId,t.workId).where(sql`${t.state}='pending'`),check('social_recommendation_state',sql`${t.state} in ('pending','saved','dismissed')`)]);
export const socialCheckins = pgTable('social_checkins',{
  id:uuid('id').primaryKey().defaultRandom(),userId:uuid('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),
  workId:uuid('work_id').notNull().references(()=>works.id,{onDelete:'cascade'}),state:text('state').notNull().default('active'),
  expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),createdAt:createdAt(),updatedAt:updatedAt(),
},t=>[uniqueIndex('social_checkin_active_unique').on(t.userId).where(sql`${t.state}='active'`),check('social_checkin_state',sql`${t.state} in ('active','cancelled','completed')`)]);
export const socialLiveState = pgTable('social_live_state',{
  connectionId:uuid('connection_id').primaryKey().references(()=>providerConnections.id,{onDelete:'cascade'}),
  accountGeneration:uuid('account_generation').notNull(),workId:uuid('work_id').references(()=>works.id,{onDelete:'set null'}),
  remoteId:text('remote_id'),expiresAt:timestamp('expires_at',{withTimezone:true}),checkedAt:timestamp('checked_at',{withTimezone:true}).notNull().defaultNow(),historyCursor:timestamp('history_cursor',{withTimezone:true}),
});
export const socialLiveDeliveries=pgTable('social_live_deliveries',{
 connectionId:uuid('connection_id').notNull().references(()=>providerConnections.id,{onDelete:'cascade'}),
 checkinId:uuid('checkin_id').notNull().references(()=>socialCheckins.id,{onDelete:'cascade'}),
 accountGeneration:uuid('account_generation').notNull(),remoteId:text('remote_id'),remoteStartedAt:timestamp('remote_started_at',{withTimezone:true}),
 state:text('state').notNull().default('uncertain'),updatedAt:updatedAt(),
},t=>[primaryKey({columns:[t.connectionId,t.checkinId]})]);

/** Completion evidence survives outbox housekeeping and is scoped to the actual account. */
export const socialScrobbleDeliveries = pgTable('social_scrobble_deliveries', {
  connectionId: uuid('connection_id').notNull().references(() => providerConnections.id, {onDelete:'cascade'}),
  sessionId: uuid('session_id').notNull(),
  workId: uuid('work_id').notNull().references(() => works.id, {onDelete:'cascade'}),
  accountGeneration: uuid('account_generation').notNull(),
  remoteId: text('remote_id'),
  state: text('state').notNull().default('uncertain'),
  updatedAt: updatedAt(),
}, t => [primaryKey({columns:[t.connectionId,t.sessionId]})]);

/** Invite redemption and onboarding are server-owned, never editable user preferences. */
export const registrationInvites = pgTable('registration_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull().unique(),
  provisionConnectionId:uuid('provision_connection_id').references(()=>providerConnections.id,{onDelete:'set null'}),
  provisionGeneration:uuid('provision_generation'),
  provisionFolders:jsonb('provision_folders').$type<string[]>(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedBy: uuid('used_by').references(() => users.id, { onDelete: 'set null' }),
  usedAt: timestamp('used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt(),
}, t => [index('registration_invite_expiry_idx').on(t.expiresAt).where(sql`${t.usedAt} is null`), index('registration_invite_revoked_idx').on(t.revokedAt).where(sql`${t.usedAt} is null and ${t.revokedAt} is not null`)]);
export const userOnboarding = pgTable('user_onboarding', {
  requiredProvider: text('required_provider').$type<'jellyfin'|'trakt'|'either'|'none'>().notNull().default('jellyfin'),
  importsStartedAt: timestamp('imports_started_at', {withTimezone:true}),
  traktConnectionId: uuid('trakt_connection_id').references(()=>providerConnections.id,{onDelete:'set null'}),
  traktAccountGeneration: uuid('trakt_account_generation'),
  importJobs: jsonb('import_jobs').$type<Record<string,string>>().notNull().default({}),
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').references(() => providerConnections.id, { onDelete: 'set null' }),
  accountGeneration: uuid('account_generation'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});
export const syncedRooms = pgTable('synced_rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  hostId: uuid('host_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mediaId: uuid('media_id').references(() => works.id, { onDelete: 'cascade' }),
  mediaType: text('media_type').$type<'audio' | 'video'>().notNull(),
  edition: text('edition').notNull().default(''),
  durationSeconds: real('duration_seconds').notNull(),
  positionSeconds: real('position_seconds').notNull().default(0),
  paused: boolean('paused').notNull().default(true),
  bufferingPaused: boolean('buffering_paused').notNull().default(false),
  bufferingPolicy: text('buffering_policy').$type<'together' | 'catch-up'>().notNull().default('together'),
  settings: jsonb('settings').$type<import('$lib/playback/synced/model').PartySettings>().notNull().default({playback:'host',controllers:[],invitations:'host',acceptInvites:true,readyCheck:false,hostDisconnect:'wait',queue:'host'}),
  queue: jsonb('queue').$type<string[]>().notNull().default([]),
  queueIndex: integer('queue_index').notNull().default(0),
  revision: integer('revision').notNull().default(1),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  updatedAt: updatedAt(),
  createdAt: createdAt(),
}, t => [index('synced_rooms_host_idx').on(t.hostId), index('synced_rooms_expiry_idx').on(t.createdAt).where(sql`${t.endedAt} is null`), index('synced_rooms_retention_idx').on(t.endedAt).where(sql`${t.endedAt} is not null`)]);
export const syncedParticipants = pgTable('synced_participants', {
  roomId: uuid('room_id').notNull().references(() => syncedRooms.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  playbackId: uuid('playback_id').references(() => playbackSessions.id, { onDelete: 'set null' }),
  joined: boolean('joined').notNull().default(false),
  buffering: boolean('buffering').notNull().default(false),
  ready: boolean('ready').notNull().default(false),
  unavailable: boolean('unavailable').notNull().default(false),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
}, t => [primaryKey({ columns: [t.roomId, t.userId] }), index('synced_participants_user_idx').on(t.userId)]);

/** Provider totals are observations, never fabricated Coast play sessions. */
export const gameAccountState = pgTable('game_account_state', {
  accountId: uuid('account_id').notNull().references(() => syncAccounts.id, {onDelete:'cascade'}),
  gameId: uuid('game_id').notNull().references(() => games.id, {onDelete:'cascade'}),
  owned: boolean('owned').notNull().default(true),
  minutesPlayed: integer('minutes_played').notNull().default(0),
  recentMinutes: integer('recent_minutes').notNull().default(0),
  lastPlayedAt: timestamp('last_played_at',{withTimezone:true}),
  hasStats: boolean('has_stats').notNull().default(false),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
  achievementsAt: timestamp('achievements_at',{withTimezone:true}),
  achievementsAttemptedAt: timestamp('achievements_attempted_at',{withTimezone:true}),
}, t => [primaryKey({columns:[t.accountId,t.gameId]}),index('game_account_state_game_idx').on(t.gameId)]);
export const gameAchievements = pgTable('game_achievements', {
  id: uuid('id').primaryKey().defaultRandom(),
  gameId: uuid('game_id').notNull().references(() => games.id,{onDelete:'cascade'}),
  provider: text('provider').notNull(),
  externalId: text('external_id').notNull(),
  name: text('name').notNull(), description: text('description').notNull().default(''),
  hidden: boolean('hidden').notNull().default(false),
  icon: text('icon'), lockedIcon: text('locked_icon'), updatedAt: updatedAt(),
},t=>[uniqueIndex('game_achievement_identity_unique').on(t.gameId,t.provider,t.externalId)]);
export const gameAchievementProgress = pgTable('game_achievement_progress', {
  accountId: uuid('account_id').notNull().references(()=>syncAccounts.id,{onDelete:'cascade'}),
  achievementId: uuid('achievement_id').notNull().references(()=>gameAchievements.id,{onDelete:'cascade'}),
  unlocked: boolean('unlocked').notNull(), unlockedAt: timestamp('unlocked_at',{withTimezone:true}), updatedAt: updatedAt(),
},t=>[primaryKey({columns:[t.accountId,t.achievementId]})]);

/** Replay evidence and deliveries commit with their domain mutation. */
export const apiIdempotency = pgTable('api_idempotency', {
 tokenId: uuid('token_id').notNull().references(()=>apiTokens.id,{onDelete:'cascade'}),
 key: text('key').notNull(), requestHash:text('request_hash').notNull(),
 response:text('response').notNull(), status:integer('status').notNull(),
 createdAt:createdAt(),
},t=>[primaryKey({columns:[t.tokenId,t.key]})]);
export const apiWebhooks = pgTable('api_webhooks', {
 id:uuid('id').primaryKey().defaultRandom(),userId:uuid('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),
 tokenId:uuid('token_id').notNull().references(()=>apiTokens.id,{onDelete:'cascade'}),
 url:text('url').notNull(),secret:text('secret').notNull(),events:jsonb('events').$type<string[]>().notNull(),
 enabled:boolean('enabled').notNull().default(true),createdAt:createdAt(),
},t=>[index('api_webhooks_user_idx').on(t.userId)]);

export const onboardingProvisioning = pgTable('onboarding_provisioning',{
 userId:uuid('user_id').primaryKey().references(()=>users.id,{onDelete:'cascade'}),
 connectionId:uuid('connection_id').references(()=>providerConnections.id,{onDelete:'set null'}),
 accountGeneration:uuid('account_generation').notNull(),folders:jsonb('folders').$type<string[]>().notNull(),
 remoteId:text('remote_id'),state:text('state').notNull().default('pending'),updatedAt:updatedAt(),
});

export const mediaPlans = pgTable('media_plans',{
 id:uuid('id').primaryKey().defaultRandom(),userId:uuid('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),
 workId:uuid('work_id').notNull().references(()=>works.id,{onDelete:'cascade'}),startsAt:timestamp('starts_at',{withTimezone:true}).notNull(),
 party:boolean('party').notNull().default(false),friends:jsonb('friends').$type<string[]>().notNull().default([]),
 state:text('state').notNull().default('scheduled'),createdAt:createdAt(),
},t=>[index('media_plans_user_start_idx').on(t.userId,t.startsAt)]);

export const playbackShares = pgTable('playback_shares',{
 id:uuid('id').primaryKey().defaultRandom(),ownerId:uuid('owner_id').notNull().references(()=>users.id,{onDelete:'cascade'}),
 workId:uuid('work_id').notNull().references(()=>works.id,{onDelete:'cascade'}),connectionId:uuid('connection_id').notNull().references(()=>providerConnections.id,{onDelete:'cascade'}),
 sourceId:text('source_id'),edition:text('edition'),
 accountGeneration:uuid('account_generation').notNull(),tokenHash:text('token_hash').notNull().unique(),
 together:boolean('together').notNull().default(false),expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),
 claimedAt:timestamp('claimed_at',{withTimezone:true}),revokedAt:timestamp('revoked_at',{withTimezone:true}),
 positionSeconds:real('position_seconds').notNull().default(0),durationSeconds:real('duration_seconds').notNull().default(0),paused:boolean('paused').notNull().default(true),updatedAt:updatedAt(),createdAt:createdAt(),
},t=>[index('playback_shares_owner_idx').on(t.ownerId)]);
export const shareViewers = pgTable('share_viewers',{
 id:uuid('id').primaryKey().defaultRandom(),shareId:uuid('share_id').notNull().references(()=>playbackShares.id,{onDelete:'cascade'}),
 tokenHash:text('token_hash').notNull().unique(),host:boolean('host').notNull().default(false),
 preparingUntil:timestamp('preparing_until',{withTimezone:true}),
 playbackId:uuid('playback_id').references(()=>playbackSessions.id,{onDelete:'set null'}),createdAt:createdAt(),
});
