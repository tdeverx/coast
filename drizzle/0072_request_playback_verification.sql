ALTER TABLE "media_requests" ADD COLUMN "playback_verified_source_id" uuid;--> statement-breakpoint
UPDATE "media_requests" SET "state" = 'processing' WHERE "state" = 'available';
