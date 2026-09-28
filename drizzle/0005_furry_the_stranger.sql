CREATE TABLE "up_next" (
	"user_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "up_next_user_id_media_id_pk" PRIMARY KEY("user_id","media_id")
);
--> statement-breakpoint
ALTER TABLE "up_next" ADD CONSTRAINT "up_next_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "up_next" ADD CONSTRAINT "up_next_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;