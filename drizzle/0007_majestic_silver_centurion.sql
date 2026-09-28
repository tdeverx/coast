ALTER TABLE "list_items" DROP CONSTRAINT "list_items_list_id_media_id_pk";--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "playlist" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "playback_started_at" timestamp with time zone;