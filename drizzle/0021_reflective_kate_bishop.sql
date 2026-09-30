CREATE TABLE "music_listen_batches" (
	"user_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"tracks" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "music_listen_batches_user_id_batch_id_pk" PRIMARY KEY("user_id","batch_id")
);
--> statement-breakpoint
ALTER TABLE "music_listen_batches" ADD CONSTRAINT "music_listen_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_listen_batches" ADD CONSTRAINT "music_listen_batches_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;