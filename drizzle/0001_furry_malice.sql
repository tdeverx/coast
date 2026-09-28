ALTER TABLE "tracking_events" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD COLUMN "review_decision" text;