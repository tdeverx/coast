CREATE INDEX "provider_items_instance_guid_idx" ON "provider_items" USING btree ("instance_id",replace(lower("external_id"),'-',''));--> statement-breakpoint
DROP INDEX "provider_items_music_guid_idx";
