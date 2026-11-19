ALTER TABLE "reading_sessions" ADD COLUMN "position_updated_at" timestamp with time zone;
--> statement-breakpoint
-- Historical sessions only recorded one clock. Preserve their last known bookmark order.
UPDATE "reading_sessions" SET "position_updated_at" = "updated_at"
WHERE "location" IS NOT NULL AND "share_id" IS NULL;
