CREATE TABLE "availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider_item_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"source_id" text DEFAULT 'default' NOT NULL,
	"edition" text,
	"container" text,
	"video_codec" text,
	"audio_codec" text,
	"bitrate" bigint,
	"width" integer,
	"height" integer,
	"duration_seconds" real,
	"state" text DEFAULT 'available' NOT NULL,
	"source" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scan_id" uuid
);
--> statement-breakpoint
CREATE TABLE "diagnostics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edition_progress" (
	"user_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"edition_id" text NOT NULL,
	"position_seconds" real DEFAULT 0 NOT NULL,
	"duration_seconds" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edition_progress_user_id_media_id_edition_id_pk" PRIMARY KEY("user_id","media_id","edition_id")
);
--> statement-breakpoint
CREATE TABLE "episode_order_items" (
	"order_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"season_number" integer NOT NULL,
	"episode_number" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "episode_order_items_order_id_episode_id_pk" PRIMARY KEY("order_id","episode_id")
);
--> statement-breakpoint
CREATE TABLE "episode_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"name" text NOT NULL,
	"provider" text,
	"external_id" text,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"media_id" uuid PRIMARY KEY NOT NULL,
	"show_id" uuid NOT NULL,
	"season_id" uuid,
	"season_number" integer NOT NULL,
	"episode_number" integer NOT NULL,
	"is_special" boolean DEFAULT false NOT NULL,
	"runtime_minutes" integer
);
--> statement-breakpoint
CREATE TABLE "external_ids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"media_kind" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"connection_id" uuid,
	"kind" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "list_items" (
	"list_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_items_list_id_media_id_pk" PRIMARY KEY("list_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source" text DEFAULT 'coast' NOT NULL,
	"external_id" text,
	"source_connection_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"original_title" text,
	"overview" text,
	"poster_path" text,
	"backdrop_path" text,
	"release_date" date,
	"year" integer,
	"runtime_minutes" integer,
	"genres" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_kind_check" CHECK ("media"."kind" in ('movie','show','season','episode','collection'))
);
--> statement-breakpoint
CREATE TABLE "media_relationships" (
	"parent_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "media_relationships_parent_id_child_id_kind_pk" PRIMARY KEY("parent_id","child_id","kind"),
	CONSTRAINT "media_relationship_not_self" CHECK ("media_relationships"."parent_id" <> "media_relationships"."child_id")
);
--> statement-breakpoint
CREATE TABLE "media_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"external_id" text,
	"server_id" integer,
	"is_4k" boolean DEFAULT false NOT NULL,
	"seasons" integer[] DEFAULT '{}' NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metadata_locks" (
	"media_id" uuid NOT NULL,
	"field" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metadata_locks_media_id_field_pk" PRIMARY KEY("media_id","field")
);
--> statement-breakpoint
CREATE TABLE "metadata_overrides" (
	"media_id" uuid PRIMARY KEY NOT NULL,
	"title" text,
	"original_title" text,
	"overview" text,
	"poster_path" text,
	"backdrop_path" text,
	"release_date" date,
	"runtime_minutes" integer,
	"genres" text[],
	"certificate" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metadata_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"instance_id" uuid,
	"title" text,
	"original_title" text,
	"overview" text,
	"poster_path" text,
	"backdrop_path" text,
	"release_date" date,
	"runtime_minutes" integer,
	"genres" text[],
	"certificate" text,
	"language" text DEFAULT 'en' NOT NULL,
	"region" text DEFAULT 'GB' NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movies" (
	"media_id" uuid PRIMARY KEY NOT NULL,
	"tagline" text,
	"status" text
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"level" text DEFAULT 'normal' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"source_key" text,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"connection_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"compaction_key" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playback_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider_item_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"edition" text,
	"provider_session_id" text,
	"delivery" text NOT NULL,
	"stream_path" text NOT NULL,
	"position_seconds" real DEFAULT 0 NOT NULL,
	"duration_seconds" real,
	"state" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"external_user_id" text,
	"username" text,
	"credentials" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"server_identity" text,
	"linked_media_instance_id" uuid,
	"credentials" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"kind" text NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"user_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"value" real NOT NULL,
	"source" text DEFAULT 'coast' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ratings_user_id_media_id_pk" PRIMARY KEY("user_id","media_id"),
	CONSTRAINT "ratings_half_stars" CHECK ("ratings"."value" between 0.5 and 5 and "ratings"."value" * 2 = floor("ratings"."value" * 2))
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"media_id" uuid PRIMARY KEY NOT NULL,
	"show_id" uuid NOT NULL,
	"season_number" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"previous_token_hash" text,
	"previous_valid_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "shows" (
	"media_id" uuid PRIMARY KEY NOT NULL,
	"status" text,
	"network" text
);
--> statement-breakpoint
CREATE TABLE "sync_checkpoints" (
	"connection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"cursor" text,
	"scan_id" uuid,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_checkpoints_connection_id_kind_pk" PRIMARY KEY("connection_id","kind")
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"action" text NOT NULL,
	"source" text DEFAULT 'coast' NOT NULL,
	"source_event_id" text,
	"edition_id" text,
	"value" boolean,
	"position_seconds" real,
	"duration_seconds" real,
	"rewatch" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied" boolean DEFAULT true NOT NULL,
	"review_reason" text
);
--> statement-breakpoint
CREATE TABLE "tracking_state" (
	"user_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"watched" boolean DEFAULT false NOT NULL,
	"play_count" integer DEFAULT 0 NOT NULL,
	"position_seconds" real DEFAULT 0 NOT NULL,
	"duration_seconds" real,
	"watchlist" boolean DEFAULT false NOT NULL,
	"favourite" boolean DEFAULT false NOT NULL,
	"collected" boolean DEFAULT false NOT NULL,
	"dropped" boolean DEFAULT false NOT NULL,
	"completed_episodes" integer DEFAULT 0 NOT NULL,
	"total_episodes" integer DEFAULT 0 NOT NULL,
	"last_watched_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracking_state_user_id_media_id_pk" PRIMARY KEY("user_id","media_id"),
	CONSTRAINT "tracking_nonnegative" CHECK ("tracking_state"."play_count" >= 0 and "tracking_state"."position_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "user_metadata_preferences" (
	"user_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"title" text,
	"poster_path" text,
	"backdrop_path" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_metadata_preferences_user_id_media_id_pk" PRIMARY KEY("user_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"email" text,
	"role" text DEFAULT 'user' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_check" CHECK ("users"."role" in ('admin', 'user'))
);
--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_provider_item_id_provider_items_id_fk" FOREIGN KEY ("provider_item_id") REFERENCES "public"."provider_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostics" ADD CONSTRAINT "diagnostics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_progress" ADD CONSTRAINT "edition_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_progress" ADD CONSTRAINT "edition_progress_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_order_items" ADD CONSTRAINT "episode_order_items_order_id_episode_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."episode_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_order_items" ADD CONSTRAINT "episode_order_items_episode_id_episodes_media_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("media_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_orders" ADD CONSTRAINT "episode_orders_show_id_shows_media_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("media_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_show_id_shows_media_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("media_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_season_id_seasons_media_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("media_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_ids" ADD CONSTRAINT "external_ids_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_source_connection_id_provider_connections_id_fk" FOREIGN KEY ("source_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_relationships" ADD CONSTRAINT "media_relationships_parent_id_media_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_relationships" ADD CONSTRAINT "media_relationships_child_id_media_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_requests" ADD CONSTRAINT "media_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_requests" ADD CONSTRAINT "media_requests_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_requests" ADD CONSTRAINT "media_requests_instance_id_provider_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."provider_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metadata_locks" ADD CONSTRAINT "metadata_locks_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metadata_overrides" ADD CONSTRAINT "metadata_overrides_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metadata_overrides" ADD CONSTRAINT "metadata_overrides_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metadata_snapshots" ADD CONSTRAINT "metadata_snapshots_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metadata_snapshots" ADD CONSTRAINT "metadata_snapshots_instance_id_provider_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."provider_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movies" ADD CONSTRAINT "movies_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_actions" ADD CONSTRAINT "outbox_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_actions" ADD CONSTRAINT "outbox_actions_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_sessions" ADD CONSTRAINT "playback_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_sessions" ADD CONSTRAINT "playback_sessions_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_sessions" ADD CONSTRAINT "playback_sessions_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_sessions" ADD CONSTRAINT "playback_sessions_provider_item_id_provider_items_id_fk" FOREIGN KEY ("provider_item_id") REFERENCES "public"."provider_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_instance_id_provider_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."provider_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_items" ADD CONSTRAINT "provider_items_instance_id_provider_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."provider_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_items" ADD CONSTRAINT "provider_items_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_show_id_shows_media_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("media_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shows" ADD CONSTRAINT "shows_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_checkpoints" ADD CONSTRAINT "sync_checkpoints_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_state" ADD CONSTRAINT "tracking_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_state" ADD CONSTRAINT "tracking_state_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_metadata_preferences" ADD CONSTRAINT "user_metadata_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_metadata_preferences" ADD CONSTRAINT "user_metadata_preferences_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "availability_source_unique" ON "availability" USING btree ("user_id","connection_id","provider_item_id","source_id");--> statement-breakpoint
CREATE INDEX "availability_user_media_idx" ON "availability" USING btree ("user_id","media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "episode_order_position_unique" ON "episode_order_items" USING btree ("order_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "episodes_show_number_unique" ON "episodes" USING btree ("show_id","season_number","episode_number");--> statement-breakpoint
CREATE INDEX "episodes_season_idx" ON "episodes" USING btree ("season_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_ids_identity_unique" ON "external_ids" USING btree ("provider","external_id","media_kind");--> statement-breakpoint
CREATE INDEX "external_ids_media_idx" ON "external_ids" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "list_items_position_idx" ON "list_items" USING btree ("list_id","position");--> statement-breakpoint
CREATE INDEX "lists_user_idx" ON "lists" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lists_source_identity_unique" ON "lists" USING btree ("user_id","source","external_id");--> statement-breakpoint
CREATE INDEX "media_title_idx" ON "media" USING btree ("title");--> statement-breakpoint
CREATE INDEX "media_kind_idx" ON "media" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "requests_user_idx" ON "media_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "requests_destination_idx" ON "media_requests" USING btree ("media_id","instance_id");--> statement-breakpoint
CREATE INDEX "metadata_snapshots_media_idx" ON "metadata_snapshots" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "metadata_snapshot_source_unique" ON "metadata_snapshots" USING btree ("media_id","provider",coalesce("instance_id", '00000000-0000-0000-0000-000000000000'::uuid),"language","region");--> statement-breakpoint
CREATE INDEX "notifications_inbox_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_source_unique" ON "notifications" USING btree ("user_id","source_key");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_actions" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "outbox_connection_order_idx" ON "outbox_actions" USING btree ("user_id","connection_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_user_instance_unique" ON "provider_connections" USING btree ("user_id","instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_items_identity_unique" ON "provider_items" USING btree ("instance_id","external_id");--> statement-breakpoint
CREATE INDEX "provider_items_media_idx" ON "provider_items" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_show_number_unique" ON "seasons" USING btree ("show_id","season_number");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tracking_source_event_unique" ON "tracking_events" USING btree ("user_id","source","source_event_id");--> statement-breakpoint
CREATE INDEX "tracking_history_idx" ON "tracking_events" USING btree ("user_id","media_id","occurred_at");--> statement-breakpoint
CREATE INDEX "tracking_state_recent_idx" ON "tracking_state" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree (lower("username"));