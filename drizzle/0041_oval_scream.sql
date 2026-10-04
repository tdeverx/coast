CREATE TABLE "recommendation_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"key" text NOT NULL,
	"seed_id" uuid,
	"connection_id" uuid,
	"account_generation" uuid,
	"items" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recommendation_sets" ADD CONSTRAINT "recommendation_sets_instance_id_provider_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."provider_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_sets" ADD CONSTRAINT "recommendation_sets_seed_id_works_id_fk" FOREIGN KEY ("seed_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_sets" ADD CONSTRAINT "recommendation_sets_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recommendation_sets_source_unique" ON "recommendation_sets" USING btree ("instance_id","key");--> statement-breakpoint
CREATE INDEX "recommendation_sets_seed_idx" ON "recommendation_sets" USING btree ("seed_id");--> statement-breakpoint
CREATE INDEX "recommendation_sets_connection_idx" ON "recommendation_sets" USING btree ("connection_id");