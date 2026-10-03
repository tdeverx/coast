CREATE TABLE "api_idempotency" (
	"token_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" text NOT NULL,
	"status" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_idempotency_token_id_key_pk" PRIMARY KEY("token_id","key")
);
--> statement-breakpoint
CREATE TABLE "api_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"party" boolean DEFAULT false NOT NULL,
	"friends" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_provisioning" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"connection_id" uuid,
	"account_generation" uuid NOT NULL,
	"folders" jsonb NOT NULL,
	"remote_id" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playback_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"account_generation" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"together" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"position_seconds" real DEFAULT 0 NOT NULL,
	"duration_seconds" real DEFAULT 0 NOT NULL,
	"paused" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playback_shares_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "share_viewers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"host" boolean DEFAULT false NOT NULL,
	"playback_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_viewers_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "playback_sessions" ADD COLUMN "share_id" uuid;--> statement-breakpoint
ALTER TABLE "registration_invites" ADD COLUMN "provision_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "registration_invites" ADD COLUMN "provision_generation" uuid;--> statement-breakpoint
ALTER TABLE "registration_invites" ADD COLUMN "provision_folders" jsonb;--> statement-breakpoint
ALTER TABLE "api_idempotency" ADD CONSTRAINT "api_idempotency_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_webhooks" ADD CONSTRAINT "api_webhooks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_webhooks" ADD CONSTRAINT "api_webhooks_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_plans" ADD CONSTRAINT "media_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_plans" ADD CONSTRAINT "media_plans_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_provisioning" ADD CONSTRAINT "onboarding_provisioning_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_provisioning" ADD CONSTRAINT "onboarding_provisioning_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_shares" ADD CONSTRAINT "playback_shares_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_shares" ADD CONSTRAINT "playback_shares_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_shares" ADD CONSTRAINT "playback_shares_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_viewers" ADD CONSTRAINT "share_viewers_share_id_playback_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."playback_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_viewers" ADD CONSTRAINT "share_viewers_playback_id_playback_sessions_id_fk" FOREIGN KEY ("playback_id") REFERENCES "public"."playback_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_webhooks_user_idx" ON "api_webhooks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "media_plans_user_start_idx" ON "media_plans" USING btree ("user_id","starts_at");--> statement-breakpoint
CREATE INDEX "playback_shares_owner_idx" ON "playback_shares" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "registration_invites" ADD CONSTRAINT "registration_invites_provision_connection_id_provider_connections_id_fk" FOREIGN KEY ("provision_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE api_tokens SET scopes=(scopes #>> '{}')::jsonb
WHERE jsonb_typeof(scopes)='string'
AND (scopes #>> '{}') ~ '^\["(catalogue|collection|library|progress):read"(,"(catalogue|collection|library|progress):read")*\]$';

--> statement-breakpoint
ALTER TABLE "playback_shares" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "playback_shares" ADD COLUMN "edition" text;
--> statement-breakpoint
ALTER TABLE "share_viewers" ADD COLUMN "preparing_until" timestamp with time zone;
