CREATE TABLE "game_external_ids" (
	"game_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	CONSTRAINT "game_external_ids_provider_external_id_pk" PRIMARY KEY("provider","external_id")
);
--> statement-breakpoint
CREATE TABLE "game_playthroughs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"platform" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"progress_percent" real DEFAULT 0 NOT NULL,
	"repeat" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_playthroughs_status_check" CHECK ("game_playthroughs"."status" in ('planned','in-progress','completed','paused','dropped')),
	CONSTRAINT "game_playthroughs_progress_check" CHECK ("game_playthroughs"."progress_percent" between 0 and 100),
	CONSTRAINT "game_playthroughs_completion_check" CHECK (("game_playthroughs"."status" = 'completed') = ("game_playthroughs"."completed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "game_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"playthrough_id" uuid NOT NULL,
	"minutes_played" integer NOT NULL,
	"played_at" timestamp with time zone NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_sessions_minutes_check" CHECK ("game_sessions"."minutes_played" between 1 and 1440)
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"overview" text,
	"release_date" date,
	"platforms" text[] DEFAULT '{}' NOT NULL,
	"genres" text[] DEFAULT '{}' NOT NULL,
	"developers" text[] DEFAULT '{}' NOT NULL,
	"publishers" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_external_ids" ADD CONSTRAINT "game_external_ids_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_playthroughs" ADD CONSTRAINT "game_playthroughs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_playthroughs" ADD CONSTRAINT "game_playthroughs_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_playthrough_id_game_playthroughs_id_fk" FOREIGN KEY ("playthrough_id") REFERENCES "public"."game_playthroughs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_external_ids_game_idx" ON "game_external_ids" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "game_playthroughs_user_game_idx" ON "game_playthroughs" USING btree ("user_id","game_id");--> statement-breakpoint
CREATE INDEX "game_sessions_playthrough_date_idx" ON "game_sessions" USING btree ("playthrough_id","played_at");--> statement-breakpoint
CREATE INDEX "games_title_idx" ON "games" USING btree ("title");