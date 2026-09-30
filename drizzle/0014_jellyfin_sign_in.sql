CREATE TABLE "user_identities" (
	"instance_id" uuid NOT NULL,
	"external_user_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_identities_instance_id_external_user_id_pk" PRIMARY KEY("instance_id","external_user_id")
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_instance_id_provider_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."provider_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_user_instance_unique" ON "user_identities" USING btree ("user_id","instance_id");