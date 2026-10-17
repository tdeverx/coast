ALTER TABLE "reading_sessions" DROP CONSTRAINT "reading_sessions_format_check";--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_format_check" CHECK ("reading_sessions"."format" in ('pdf','epub','cbz','cbr','cb7','cbt'));--> statement-breakpoint
ALTER TABLE "synced_rooms" DROP CONSTRAINT "synced_rooms_reading_format_check";--> statement-breakpoint
ALTER TABLE "synced_rooms" ADD CONSTRAINT "synced_rooms_reading_format_check" CHECK ("synced_rooms"."reading_format" in ('pdf','epub','cbz','cbr','cb7','cbt'));
