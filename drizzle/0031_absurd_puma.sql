CREATE TABLE "game_account_state" (
	"account_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"owned" boolean DEFAULT true NOT NULL,
	"minutes_played" integer DEFAULT 0 NOT NULL,
	"recent_minutes" integer DEFAULT 0 NOT NULL,
	"last_played_at" timestamp with time zone,
	"has_stats" boolean DEFAULT false NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"achievements_at" timestamp with time zone,
	"achievements_attempted_at" timestamp with time zone,
	CONSTRAINT "game_account_state_account_id_game_id_pk" PRIMARY KEY("account_id","game_id")
);
--> statement-breakpoint
CREATE TABLE "game_achievement_progress" (
	"account_id" uuid NOT NULL,
	"achievement_id" uuid NOT NULL,
	"unlocked" boolean NOT NULL,
	"unlocked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_achievement_progress_account_id_achievement_id_pk" PRIMARY KEY("account_id","achievement_id")
);
--> statement-breakpoint
CREATE TABLE "game_achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"icon" text,
	"locked_icon" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_account_state" ADD CONSTRAINT "game_account_state_account_id_sync_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."sync_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_account_state" ADD CONSTRAINT "game_account_state_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_achievement_progress" ADD CONSTRAINT "game_achievement_progress_account_id_sync_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."sync_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_achievement_progress" ADD CONSTRAINT "game_achievement_progress_achievement_id_game_achievements_id_fk" FOREIGN KEY ("achievement_id") REFERENCES "public"."game_achievements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_achievements" ADD CONSTRAINT "game_achievements_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_account_state_game_idx" ON "game_account_state" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_achievement_identity_unique" ON "game_achievements" USING btree ("game_id","provider","external_id");