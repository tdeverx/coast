CREATE TABLE "removed_tracking_sources" (
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_event_id" text NOT NULL,
	CONSTRAINT "removed_tracking_sources_user_id_source_source_event_id_pk" PRIMARY KEY("user_id","source","source_event_id")
);
--> statement-breakpoint
ALTER TABLE "removed_tracking_sources" ADD CONSTRAINT "removed_tracking_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;