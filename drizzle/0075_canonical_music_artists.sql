-- Preserve each source identity independently. Names never establish artist identity.
ALTER TABLE "music_artists" ADD COLUMN "work_id" uuid;--> statement-breakpoint
INSERT INTO works(id,category,kind) SELECT id,'music','artist' FROM music_artists;--> statement-breakpoint
INSERT INTO music_works(id,title,kind) SELECT id,name,'artist' FROM music_artists;--> statement-breakpoint
UPDATE music_artists SET work_id=id;--> statement-breakpoint
-- Credits belong to the catalogue artist, so removing a source cannot erase membership.
ALTER TABLE music_credits DROP CONSTRAINT music_credits_artist_id_music_artists_id_fk;--> statement-breakpoint
ALTER TABLE music_credits ADD CONSTRAINT music_credits_artist_id_works_id_fk FOREIGN KEY (artist_id) REFERENCES works(id) ON DELETE CASCADE;--> statement-breakpoint
INSERT INTO provider_items(instance_id,media_id,external_id,kind,snapshot)
SELECT instance_id,work_id,external_id,'artist',jsonb_build_object('id',external_id,'kind','artist','title',name,
  'artists','[]'::jsonb,'albumArtists','[]'::jsonb,'artistNames','[]'::jsonb,'genres','[]'::jsonb,'externalIds','{}'::jsonb)
FROM music_artists ON CONFLICT(instance_id,external_id) DO NOTHING;--> statement-breakpoint
-- Keep durable favourite events as well as their projection, so a rebuild retains choices.
INSERT INTO tracking_events(user_id,media_id,action,source,source_event_id,value)
SELECT p.user_id,a.work_id,'favourite','coast','artist-migration:'||a.id,p.favourite
FROM music_artist_preferences p JOIN music_artists a ON a.id=p.artist_id;--> statement-breakpoint
INSERT INTO tracking_state(user_id,media_id,favourite)
SELECT p.user_id,a.work_id,p.favourite FROM music_artist_preferences p JOIN music_artists a ON a.id=p.artist_id
ON CONFLICT(user_id,media_id) DO UPDATE SET favourite=excluded.favourite;--> statement-breakpoint
DROP TABLE "music_artist_preferences";--> statement-breakpoint
ALTER TABLE "music_artists" ALTER COLUMN "work_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "music_artists" ADD CONSTRAINT "music_artists_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "music_artists_work_idx" ON "music_artists" USING btree ("work_id");
--> statement-breakpoint
CREATE INDEX "music_credits_artist_work_idx" ON "music_credits" USING btree ("artist_id","work_id");
