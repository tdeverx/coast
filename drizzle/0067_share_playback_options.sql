ALTER TABLE "playback_sessions" ADD COLUMN "share_segment_coverage" "int8multirange";--> statement-breakpoint
ALTER TABLE "playback_shares" ADD COLUMN "auto_revoke" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "playback_shares" ADD COLUMN "track_progress" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "playback_shares" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "playback_shares_auto_revoke_idx" ON "playback_shares" USING btree ("expires_at") WHERE "playback_shares"."auto_revoke" and "playback_shares"."revoked_at" is null;