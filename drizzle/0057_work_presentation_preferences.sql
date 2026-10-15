ALTER TABLE "user_metadata_preferences" DROP CONSTRAINT "user_metadata_preferences_media_id_media_id_fk";
--> statement-breakpoint
ALTER TABLE "user_metadata_preferences" ADD CONSTRAINT "user_metadata_preferences_media_id_works_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;