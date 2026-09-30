CREATE TABLE "collection_projection_entries" (
	"account_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"attribution" text NOT NULL,
	"remote" jsonb NOT NULL,
	"desired" boolean DEFAULT true NOT NULL,
	"conflict" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_projection_entries_account_id_work_id_pk" PRIMARY KEY("account_id","work_id")
);
--> statement-breakpoint
CREATE TABLE "collection_projection_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"configuration_version" uuid NOT NULL,
	"configuration" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "music_artist_preferences" (
	"user_id" uuid NOT NULL,
	"artist_id" uuid NOT NULL,
	"favourite" boolean DEFAULT false NOT NULL,
	CONSTRAINT "music_artist_preferences_user_id_artist_id_pk" PRIMARY KEY("user_id","artist_id")
);
--> statement-breakpoint
CREATE TABLE "music_artists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "music_credits" (
	"work_id" uuid NOT NULL,
	"artist_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "music_credits_work_id_artist_id_role_pk" PRIMARY KEY("work_id","artist_id","role")
);
--> statement-breakpoint
CREATE TABLE "music_listens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"source" text DEFAULT 'coast' NOT NULL,
	"occurred_at_known" boolean DEFAULT true NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "music_progress" (
	"user_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"position_seconds" real DEFAULT 0 NOT NULL,
	"duration_seconds" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "music_progress_user_id_track_id_pk" PRIMARY KEY("user_id","track_id")
);
--> statement-breakpoint
CREATE TABLE "music_works" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"artist_names" text[] DEFAULT '{}' NOT NULL,
	"release_date" date,
	"year" integer,
	"duration_seconds" real,
	"overview" text,
	"genres" text[] DEFAULT '{}' NOT NULL,
	"membership_complete" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_intents" (
	"connection_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"category" text NOT NULL,
	"value" jsonb NOT NULL,
	"version" uuid DEFAULT gen_random_uuid() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_intents_connection_id_work_id_category_pk" PRIMARY KEY("connection_id","work_id","category")
);
--> statement-breakpoint
CREATE TABLE "sync_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"server_identity" text NOT NULL,
	"external_user_id" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_editions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"instance_id" uuid,
	"external_id" text NOT NULL,
	"format" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_identifiers" (
	"work_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "work_identifiers_provider_external_id_kind_pk" PRIMARY KEY("provider","external_id","kind")
);
--> statement-breakpoint
CREATE TABLE "works" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "availability" DROP CONSTRAINT "availability_media_id_media_id_fk";
--> statement-breakpoint
ALTER TABLE "list_items" DROP CONSTRAINT "list_items_media_id_media_id_fk";
--> statement-breakpoint
ALTER TABLE "media_relationships" DROP CONSTRAINT "media_relationships_parent_id_media_id_fk";
--> statement-breakpoint
ALTER TABLE "media_relationships" DROP CONSTRAINT "media_relationships_child_id_media_id_fk";
--> statement-breakpoint
ALTER TABLE "playback_sessions" DROP CONSTRAINT "playback_sessions_media_id_media_id_fk";
--> statement-breakpoint
ALTER TABLE "provider_items" DROP CONSTRAINT "provider_items_media_id_media_id_fk";
--> statement-breakpoint
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_media_id_media_id_fk";
--> statement-breakpoint
ALTER TABLE "sync_values" DROP CONSTRAINT "sync_values_media_id_media_id_fk";
--> statement-breakpoint
ALTER TABLE "tracking_events" DROP CONSTRAINT "tracking_events_media_id_media_id_fk";
--> statement-breakpoint
ALTER TABLE "tracking_state" DROP CONSTRAINT "tracking_state_media_id_media_id_fk";
--> statement-breakpoint
ALTER TABLE "up_next" DROP CONSTRAINT "up_next_media_id_media_id_fk";
--> statement-breakpoint
ALTER TABLE "outbox_actions" ADD COLUMN "account_generation" uuid;--> statement-breakpoint
ALTER TABLE "playback_sessions" ADD COLUMN "media_type" text DEFAULT 'video' NOT NULL;--> statement-breakpoint
ALTER TABLE "playback_sessions" ADD COLUMN "played_seconds" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "playback_sessions" ADD COLUMN "listen_threshold" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "playback_sessions" ADD COLUMN "listen_recorded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD COLUMN "account_generation" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD COLUMN "sync_account_id" uuid;--> statement-breakpoint
ALTER TABLE "sync_list_values" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "sync_values" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "collection_projection_entries" ADD CONSTRAINT "collection_projection_entries_account_id_sync_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."sync_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_projection_entries" ADD CONSTRAINT "collection_projection_entries_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_projection_previews" ADD CONSTRAINT "collection_projection_previews_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_projection_previews" ADD CONSTRAINT "collection_projection_previews_account_id_sync_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."sync_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_artist_preferences" ADD CONSTRAINT "music_artist_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_artist_preferences" ADD CONSTRAINT "music_artist_preferences_artist_id_music_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."music_artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_artists" ADD CONSTRAINT "music_artists_instance_id_provider_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."provider_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_credits" ADD CONSTRAINT "music_credits_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_credits" ADD CONSTRAINT "music_credits_artist_id_music_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."music_artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_listens" ADD CONSTRAINT "music_listens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_listens" ADD CONSTRAINT "music_listens_track_id_music_works_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."music_works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_progress" ADD CONSTRAINT "music_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_progress" ADD CONSTRAINT "music_progress_track_id_music_works_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."music_works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_works" ADD CONSTRAINT "music_works_id_works_id_fk" FOREIGN KEY ("id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_intents" ADD CONSTRAINT "reconciliation_intents_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_intents" ADD CONSTRAINT "reconciliation_intents_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_accounts" ADD CONSTRAINT "sync_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_accounts" ADD CONSTRAINT "sync_accounts_instance_id_provider_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."provider_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_editions" ADD CONSTRAINT "work_editions_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_editions" ADD CONSTRAINT "work_editions_instance_id_provider_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."provider_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_identifiers" ADD CONSTRAINT "work_identifiers_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "music_artists_identity_unique" ON "music_artists" USING btree ("instance_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "music_listens_batch_unique" ON "music_listens" USING btree ("user_id","track_id","batch_id");--> statement-breakpoint
CREATE INDEX "music_listens_user_track_idx" ON "music_listens" USING btree ("user_id","track_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_accounts_identity_unique" ON "sync_accounts" USING btree ("user_id","instance_id","server_identity","external_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_editions_identity_unique" ON "work_editions" USING btree ("instance_id","external_id");--> statement-breakpoint
CREATE INDEX "work_identifiers_work_idx" ON "work_identifiers" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "works_category_kind_idx" ON "works" USING btree ("category","kind");--> statement-breakpoint
INSERT INTO works (id, category, kind, created_at) SELECT id, 'screen', kind, created_at FROM media;
--> statement-breakpoint
INSERT INTO works (id, category, kind, created_at) SELECT id, 'game', 'game', created_at FROM games;
--> statement-breakpoint
CREATE FUNCTION register_concrete_work() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE work_kind text;
BEGIN
  IF TG_OP = 'DELETE' THEN DELETE FROM works WHERE id = OLD.id; RETURN OLD; END IF;
  IF TG_ARGV[0]='game' THEN work_kind='game'; ELSE work_kind=NEW.kind; END IF;
  INSERT INTO works (id, category, kind) VALUES (NEW.id, TG_ARGV[0], work_kind)
    ON CONFLICT (id) DO UPDATE SET kind=EXCLUDED.kind;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_register_work AFTER INSERT OR UPDATE OF kind OR DELETE ON media FOR EACH ROW EXECUTE FUNCTION register_concrete_work('screen');
--> statement-breakpoint
CREATE TRIGGER games_register_work AFTER INSERT OR DELETE ON games FOR EACH ROW EXECUTE FUNCTION register_concrete_work('game');
--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_media_id_works_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_media_id_works_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_relationships" ADD CONSTRAINT "media_relationships_parent_id_works_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_relationships" ADD CONSTRAINT "media_relationships_child_id_works_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_sessions" ADD CONSTRAINT "playback_sessions_media_id_works_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_sync_account_id_sync_accounts_id_fk" FOREIGN KEY ("sync_account_id") REFERENCES "public"."sync_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_items" ADD CONSTRAINT "provider_items_media_id_works_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_media_id_works_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_list_values" ADD CONSTRAINT "sync_list_values_account_id_sync_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."sync_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_values" ADD CONSTRAINT "sync_values_account_id_sync_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."sync_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_values" ADD CONSTRAINT "sync_values_media_id_works_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_media_id_works_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_state" ADD CONSTRAINT "tracking_state_media_id_works_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "up_next" ADD CONSTRAINT "up_next_media_id_works_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO sync_accounts (user_id,instance_id,server_identity,external_user_id)
  SELECT c.user_id,c.instance_id,coalesce(i.server_identity,i.id::text),c.external_user_id FROM provider_connections c JOIN provider_instances i ON i.id=c.instance_id WHERE c.external_user_id IS NOT NULL;
--> statement-breakpoint
UPDATE provider_connections c SET sync_account_id=a.id FROM sync_accounts a WHERE a.user_id=c.user_id AND a.instance_id=c.instance_id AND a.external_user_id=c.external_user_id;
--> statement-breakpoint
UPDATE outbox_actions o SET account_generation=c.account_generation FROM provider_connections c WHERE o.connection_id=c.id;
--> statement-breakpoint
UPDATE sync_values v SET account_id=c.sync_account_id FROM provider_connections c WHERE c.id=v.connection_id;
--> statement-breakpoint
UPDATE sync_list_values v SET account_id=c.sync_account_id FROM provider_connections c WHERE c.id=v.connection_id;
--> statement-breakpoint
CREATE FUNCTION bind_sync_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.account_id IS NULL THEN SELECT sync_account_id INTO NEW.account_id FROM provider_connections WHERE id=NEW.connection_id; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sync_values_bind_account BEFORE INSERT ON sync_values FOR EACH ROW EXECUTE FUNCTION bind_sync_account();
--> statement-breakpoint
CREATE TRIGGER sync_list_values_bind_account BEFORE INSERT ON sync_list_values FOR EACH ROW EXECUTE FUNCTION bind_sync_account();
--> statement-breakpoint
CREATE FUNCTION pin_outbox_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.connection_id IS NOT NULL THEN SELECT account_generation INTO NEW.account_generation FROM provider_connections WHERE id=NEW.connection_id; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER outbox_pin_account BEFORE INSERT ON outbox_actions FOR EACH ROW EXECUTE FUNCTION pin_outbox_account();
--> statement-breakpoint
CREATE FUNCTION update_connection_account() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE server_key text; account_key uuid;
BEGIN
  IF TG_OP='UPDATE' AND OLD.external_user_id IS DISTINCT FROM NEW.external_user_id AND NEW.external_user_id IS NOT NULL THEN
    NEW.account_generation=gen_random_uuid();
    DELETE FROM sync_checkpoints WHERE connection_id=OLD.id;
    DELETE FROM sync_values WHERE connection_id=OLD.id;
    DELETE FROM sync_list_values WHERE connection_id=OLD.id;
    DELETE FROM reconciliation_intents WHERE connection_id=OLD.id;
    UPDATE availability SET state='unknown' WHERE connection_id=OLD.id;
    UPDATE outbox_actions SET state='cancelled',updated_at=now() WHERE connection_id=OLD.id AND state IN ('pending','failed','running');
  END IF;
  IF NEW.external_user_id IS NOT NULL THEN
    SELECT coalesce(server_identity,id::text) INTO server_key FROM provider_instances WHERE id=NEW.instance_id;
    INSERT INTO sync_accounts(user_id,instance_id,server_identity,external_user_id) VALUES(NEW.user_id,NEW.instance_id,server_key,NEW.external_user_id)
      ON CONFLICT(user_id,instance_id,server_identity,external_user_id) DO UPDATE SET verified_at=now() RETURNING id INTO account_key;
    NEW.sync_account_id=account_key;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER provider_connections_account BEFORE INSERT OR UPDATE OF external_user_id ON provider_connections FOR EACH ROW EXECUTE FUNCTION update_connection_account();
