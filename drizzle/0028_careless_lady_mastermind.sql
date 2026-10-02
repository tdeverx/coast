CREATE TABLE "registration_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_by" uuid,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "synced_participants" (
	"room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"playback_id" uuid,
	"joined" boolean DEFAULT false NOT NULL,
	"buffering" boolean DEFAULT false NOT NULL,
	"heartbeat_at" timestamp with time zone,
	CONSTRAINT "synced_participants_room_id_user_id_pk" PRIMARY KEY("room_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "synced_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"media_type" text NOT NULL,
	"edition" text DEFAULT '' NOT NULL,
	"duration_seconds" real NOT NULL,
	"position_seconds" real DEFAULT 0 NOT NULL,
	"paused" boolean DEFAULT true NOT NULL,
	"buffering_paused" boolean DEFAULT false NOT NULL,
	"buffering_policy" text DEFAULT 'together' NOT NULL,
	"queue" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"ended_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_onboarding" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"connection_id" uuid,
	"account_generation" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "registration_invites" ADD CONSTRAINT "registration_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_invites" ADD CONSTRAINT "registration_invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synced_participants" ADD CONSTRAINT "synced_participants_room_id_synced_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."synced_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synced_participants" ADD CONSTRAINT "synced_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synced_participants" ADD CONSTRAINT "synced_participants_playback_id_playback_sessions_id_fk" FOREIGN KEY ("playback_id") REFERENCES "public"."playback_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synced_rooms" ADD CONSTRAINT "synced_rooms_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synced_rooms" ADD CONSTRAINT "synced_rooms_media_id_works_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD CONSTRAINT "user_onboarding_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD CONSTRAINT "user_onboarding_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "synced_participants_user_idx" ON "synced_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "synced_rooms_host_idx" ON "synced_rooms" USING btree ("host_id");--> statement-breakpoint
CREATE FUNCTION invalidate_synced_playback_connection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.external_user_id IS DISTINCT FROM NEW.external_user_id OR NEW.status <> 'connected' THEN
    UPDATE playback_sessions SET expires_at=NOW() WHERE connection_id=NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invalidate_synced_playback_connection AFTER UPDATE OF external_user_id,status ON provider_connections FOR EACH ROW EXECUTE FUNCTION invalidate_synced_playback_connection();
