CREATE TABLE "task_control_commands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"instance_id" uuid,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"target_ids" uuid[],
	"outcomes" jsonb,
	"total" integer NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"has_more" boolean DEFAULT false NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"last_error" text,
	"compacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_control_bounds" CHECK ("task_control_commands"."total" between 0 and 100 and "task_control_commands"."updated">=0 and "task_control_commands"."skipped">=0 and "task_control_commands"."updated"+"task_control_commands"."skipped"<="task_control_commands"."total" and "task_control_commands"."revision">=0),
	CONSTRAINT "task_control_state" CHECK ("task_control_commands"."action" in ('retry','cancel','promote') and "task_control_commands"."status" in ('incomplete','complete','abandoned') and ("task_control_commands"."status"<>'complete' or "task_control_commands"."updated"+"task_control_commands"."skipped"="task_control_commands"."total")),
	CONSTRAINT "task_control_details" CHECK (("task_control_commands"."compacted_at" is null and "task_control_commands"."target_ids" is not null and "task_control_commands"."outcomes" is not null and cardinality("task_control_commands"."target_ids")="task_control_commands"."total" and jsonb_typeof("task_control_commands"."outcomes")='array' and jsonb_array_length("task_control_commands"."outcomes")="task_control_commands"."updated"+"task_control_commands"."skipped") or ("task_control_commands"."compacted_at" is not null and "task_control_commands"."status"<>'incomplete' and "task_control_commands"."target_ids" is null and "task_control_commands"."outcomes" is null))
);
--> statement-breakpoint
ALTER TABLE "task_control_commands" ADD CONSTRAINT "task_control_commands_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_control_actor_idx" ON "task_control_commands" USING btree ("actor_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "task_control_commands"."status"<>'incomplete';--> statement-breakpoint
CREATE INDEX "task_control_incomplete_idx" ON "task_control_commands" USING btree ("actor_id","created_at","id") WHERE "task_control_commands"."status"='incomplete';--> statement-breakpoint
CREATE INDEX "task_control_compact_idx" ON "task_control_commands" USING btree ("updated_at") WHERE "task_control_commands"."status"<>'incomplete' and "task_control_commands"."compacted_at" is null;