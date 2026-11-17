ALTER TABLE "share_request_leases" ALTER COLUMN "playback_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD COLUMN "share_id" uuid;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD COLUMN "share_viewer_id" uuid;--> statement-breakpoint
ALTER TABLE "share_request_leases" ADD COLUMN "reading_id" uuid;--> statement-breakpoint
ALTER TABLE "share_viewers" ADD COLUMN "reading_session_id" uuid;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_share_id_playback_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."playback_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_share_viewer_id_share_viewers_id_fk" FOREIGN KEY ("share_viewer_id") REFERENCES "public"."share_viewers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_request_leases" ADD CONSTRAINT "share_request_leases_reading_id_reading_sessions_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."reading_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_viewers" ADD CONSTRAINT "share_viewers_reading_session_id_reading_sessions_id_fk" FOREIGN KEY ("reading_session_id") REFERENCES "public"."reading_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reading_sessions_shared_viewer_idx" ON "reading_sessions" USING btree ("share_viewer_id") WHERE "reading_sessions"."share_viewer_id" is not null and "reading_sessions"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "share_request_leases_reading_idx" ON "share_request_leases" USING btree ("reading_id","expires_at");--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_share_check" CHECK (("reading_sessions"."share_id" is null)=("reading_sessions"."share_viewer_id" is null) and ("reading_sessions"."share_id" is null or ("reading_sessions"."connection_id" is not null and "reading_sessions"."location" is null)));--> statement-breakpoint
ALTER TABLE "share_request_leases" ADD CONSTRAINT "share_request_leases_target_check" CHECK (("share_request_leases"."playback_id" is not null)<>("share_request_leases"."reading_id" is not null));