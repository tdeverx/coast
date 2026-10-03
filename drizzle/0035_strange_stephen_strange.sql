ALTER TABLE "user_onboarding" ADD COLUMN "required_provider" text DEFAULT 'jellyfin' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD COLUMN "imports_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD COLUMN "trakt_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD COLUMN "trakt_account_generation" uuid;--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD COLUMN "import_jobs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD CONSTRAINT "user_onboarding_trakt_connection_id_provider_connections_id_fk" FOREIGN KEY ("trakt_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE set null ON UPDATE no action;