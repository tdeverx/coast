CREATE TABLE "subtitle_downloads" (
	"provider_item_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_loaded_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	CONSTRAINT "subtitle_downloads_provider_item_id_source_id_fingerprint_pk" PRIMARY KEY("provider_item_id","source_id","fingerprint")
);
--> statement-breakpoint
CREATE TABLE "subtitle_preferences" (
	"user_id" uuid NOT NULL,
	"provider_item_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	CONSTRAINT "subtitle_preferences_user_id_provider_item_id_source_id_pk" PRIMARY KEY("user_id","provider_item_id","source_id")
);
--> statement-breakpoint
ALTER TABLE "subtitle_downloads" ADD CONSTRAINT "subtitle_downloads_provider_item_id_provider_items_id_fk" FOREIGN KEY ("provider_item_id") REFERENCES "public"."provider_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtitle_preferences" ADD CONSTRAINT "subtitle_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtitle_preferences" ADD CONSTRAINT "subtitle_preferences_provider_item_id_provider_items_id_fk" FOREIGN KEY ("provider_item_id") REFERENCES "public"."provider_items"("id") ON DELETE cascade ON UPDATE no action;