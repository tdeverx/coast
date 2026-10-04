CREATE TABLE "game_variants" (
	"game_id" uuid PRIMARY KEY NOT NULL,
	"parent_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_variants_distinct_check" CHECK ("game_variants"."game_id"<>"game_variants"."parent_id")
);
--> statement-breakpoint
CREATE TABLE "user_taste_profiles" (
	"user_id" uuid NOT NULL,
	"medium" text NOT NULL,
	"revision" text NOT NULL,
	"profile" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_taste_profiles_user_id_medium_pk" PRIMARY KEY("user_id","medium")
);
--> statement-breakpoint
CREATE TABLE "user_taste_scores" (
	"user_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"score" real,
	"confidence" real NOT NULL,
	"revision" text NOT NULL,
	"breakdown" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_taste_scores_user_id_work_id_pk" PRIMARY KEY("user_id","work_id")
);
--> statement-breakpoint
CREATE TABLE "work_features" (
	"work_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_features_work_id_provider_pk" PRIMARY KEY("work_id","provider")
);
--> statement-breakpoint
ALTER TABLE "game_variants" ADD CONSTRAINT "game_variants_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_variants" ADD CONSTRAINT "game_variants_parent_id_games_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_taste_profiles" ADD CONSTRAINT "user_taste_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_taste_scores" ADD CONSTRAINT "user_taste_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_taste_scores" ADD CONSTRAINT "user_taste_scores_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_features" ADD CONSTRAINT "work_features_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_variants_parent_idx" ON "game_variants" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "user_taste_scores_rank_idx" ON "user_taste_scores" USING btree ("user_id","score","work_id");--> statement-breakpoint
CREATE INDEX "work_features_lookup_idx" ON "work_features" USING gin ("features");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_taste_one_active_idx" ON "jobs" USING btree ("kind") WHERE "jobs"."kind"='taste.refresh' and "jobs"."state" in ('pending','running','failed');
--> statement-breakpoint
CREATE TRIGGER work_features_content_insert AFTER INSERT ON work_features REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');

--> statement-breakpoint
CREATE TRIGGER work_features_content_update AFTER UPDATE ON work_features REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');

--> statement-breakpoint
CREATE TRIGGER work_features_content_delete AFTER DELETE ON work_features REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');

--> statement-breakpoint
CREATE TRIGGER game_variants_content_insert AFTER INSERT ON game_variants REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');

--> statement-breakpoint
CREATE TRIGGER game_variants_content_update AFTER UPDATE ON game_variants REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');

--> statement-breakpoint
CREATE TRIGGER game_variants_content_delete AFTER DELETE ON game_variants REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
