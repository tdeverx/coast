ALTER TABLE "social_checkins" ADD COLUMN "mode" text DEFAULT 'timed' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_checkins" ADD CONSTRAINT "social_checkin_mode" CHECK ("social_checkins"."mode" in ('timed','manual'));
