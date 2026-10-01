CREATE TABLE "social_scrobble_deliveries" (
	"connection_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"account_generation" uuid NOT NULL,
	"remote_id" text,
	"state" text DEFAULT 'uncertain' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_scrobble_deliveries_connection_id_session_id_pk" PRIMARY KEY("connection_id","session_id")
);
--> statement-breakpoint
ALTER TABLE "social_scrobble_deliveries" ADD CONSTRAINT "social_scrobble_deliveries_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_scrobble_deliveries" ADD CONSTRAINT "social_scrobble_deliveries_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;