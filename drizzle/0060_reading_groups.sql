CREATE TABLE "reading_group_members" (
	"group_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"position" text NOT NULL,
	CONSTRAINT "reading_group_members_group_id_work_id_pk" PRIMARY KEY("group_id","work_id")
);
--> statement-breakpoint
CREATE TABLE "reading_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	CONSTRAINT "reading_groups_identity_check" CHECK ("reading_groups"."provider"='comic-vine' and "reading_groups"."kind"='comic' and "reading_groups"."external_id" ~ '^4050-[1-9][0-9]{0,14}$')
);
--> statement-breakpoint
ALTER TABLE "reading_group_members" ADD CONSTRAINT "reading_group_members_group_id_reading_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."reading_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_group_members" ADD CONSTRAINT "reading_group_members_work_id_reading_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."reading_works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reading_group_members_work_idx" ON "reading_group_members" USING btree ("work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reading_groups_identity_idx" ON "reading_groups" USING btree ("provider","external_id");
--> statement-breakpoint
CREATE TRIGGER reading_groups_content_insert AFTER INSERT ON reading_groups REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');

--> statement-breakpoint
CREATE TRIGGER reading_groups_content_update AFTER UPDATE ON reading_groups REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');

--> statement-breakpoint
CREATE TRIGGER reading_groups_content_delete AFTER DELETE ON reading_groups REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');

--> statement-breakpoint
CREATE TRIGGER reading_group_members_content_insert AFTER INSERT ON reading_group_members REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');

--> statement-breakpoint
CREATE TRIGGER reading_group_members_content_update AFTER UPDATE ON reading_group_members REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');

--> statement-breakpoint
CREATE TRIGGER reading_group_members_content_delete AFTER DELETE ON reading_group_members REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
