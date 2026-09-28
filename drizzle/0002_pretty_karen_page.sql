CREATE TABLE "sync_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"category" text NOT NULL,
	"remote" jsonb NOT NULL,
	"agreed" jsonb,
	"conflict" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_values" ADD CONSTRAINT "sync_values_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_values" ADD CONSTRAINT "sync_values_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_values_identity_unique" ON "sync_values" USING btree ("connection_id","media_id","category");