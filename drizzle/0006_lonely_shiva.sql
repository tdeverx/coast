CREATE TABLE "rewatches" (
	"user_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rewatches_user_id_media_id_pk" PRIMARY KEY("user_id","media_id")
);
--> statement-breakpoint
ALTER TABLE "rewatches" ADD CONSTRAINT "rewatches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewatches" ADD CONSTRAINT "rewatches_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;