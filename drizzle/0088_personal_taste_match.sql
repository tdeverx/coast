CREATE TABLE "user_taste_match_members" (
	"user_id" uuid NOT NULL,
	"medium" text NOT NULL,
	"root" uuid NOT NULL,
	"fold" smallint NOT NULL,
	CONSTRAINT "user_taste_match_members_user_id_root_pk" PRIMARY KEY("user_id","root"),
	CONSTRAINT "user_taste_match_members_fold" CHECK ("user_taste_match_members"."fold" between 0 and 4)
);
--> statement-breakpoint
CREATE TABLE "user_taste_match_models" (
	"user_id" uuid NOT NULL,
	"medium" text NOT NULL,
	"fold" smallint NOT NULL,
	"revision" text NOT NULL,
	"model" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_taste_match_models_user_id_medium_fold_pk" PRIMARY KEY("user_id","medium","fold"),
	CONSTRAINT "user_taste_match_models_fold" CHECK ("user_taste_match_models"."fold" between -1 and 4)
);
--> statement-breakpoint
ALTER TABLE "user_taste_match_members" ADD CONSTRAINT "user_taste_match_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_taste_match_members" ADD CONSTRAINT "user_taste_match_members_root_works_id_fk" FOREIGN KEY ("root") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_taste_match_models" ADD CONSTRAINT "user_taste_match_models_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;