-- Ordered album membership belongs to an exact provider release. Existing work
-- relationships remain the deduplicated Collection projection of that release.
ALTER TABLE music_works ADD COLUMN selected_edition_id uuid CONSTRAINT music_works_selected_edition_id_work_editions_id_fk REFERENCES work_editions(id) ON DELETE SET NULL;
CREATE INDEX music_artists_guid_idx ON music_artists(instance_id,replace(lower(external_id),'-',''));
CREATE INDEX provider_items_music_guid_idx ON provider_items(instance_id,replace(lower(external_id),'-','')) WHERE kind IN ('album','track');
CREATE INDEX work_editions_guid_idx ON work_editions(instance_id,replace(lower(external_id),'-',''));
CREATE INDEX work_editions_music_album_idx ON work_editions(instance_id,replace(lower(metadata->>'albumExternalId'),'-',''));
--> statement-breakpoint
WITH snapshots AS (
  SELECT DISTINCT ON (p.instance_id,replace(lower(p.external_id),'-',''),p.media_id) p.*
  FROM provider_items p JOIN music_works m ON m.id=p.media_id AND m.kind='track'
  WHERE p.snapshot->>'albumId' IS NOT NULL
  ORDER BY p.instance_id,replace(lower(p.external_id),'-',''),p.media_id,p.last_seen_at DESC,p.id
) UPDATE work_editions e SET metadata=e.metadata || jsonb_build_object(
  'albumExternalId',replace(lower(p.snapshot->>'albumId'),'-',''),
  'discNumber',p.snapshot->'discNumber','trackNumber',p.snapshot->'trackNumber',
  'position',coalesce((p.snapshot->>'discNumber')::numeric,1)*10000+coalesce((p.snapshot->>'trackNumber')::numeric,0))
FROM snapshots p
WHERE p.instance_id=e.instance_id AND p.media_id=e.work_id AND replace(lower(p.external_id),'-','')=replace(lower(e.external_id),'-','');
--> statement-breakpoint
WITH chosen AS (
  SELECT DISTINCT ON (e.work_id) e.work_id,e.id FROM work_editions e JOIN music_works m ON m.id=e.work_id AND m.kind='album'
  WHERE e.instance_id IS NOT NULL AND EXISTS(SELECT 1 FROM work_editions t JOIN music_works track ON track.id=t.work_id AND track.kind='track'
    WHERE t.instance_id=e.instance_id AND replace(lower(t.metadata->>'albumExternalId'),'-','')=replace(lower(e.external_id),'-',''))
  ORDER BY e.work_id,e.instance_id,replace(lower(e.external_id),'-',''),e.id
) UPDATE music_works m SET selected_edition_id=chosen.id FROM chosen WHERE m.id=chosen.work_id;
--> statement-breakpoint
DELETE FROM media_relationships r USING music_works m WHERE r.parent_id=m.id AND r.kind='contains' AND m.selected_edition_id IS NOT NULL;
--> statement-breakpoint
WITH members AS (
SELECT DISTINCT ON(a.id,replace(lower(t.external_id),'-','')) a.id,t.work_id,(t.metadata->>'position')::numeric as position FROM music_works a
JOIN work_editions e ON e.id=a.selected_edition_id JOIN work_editions t ON t.instance_id=e.instance_id
  AND replace(lower(t.metadata->>'albumExternalId'),'-','')=replace(lower(e.external_id),'-','')
JOIN music_works track ON track.id=t.work_id AND track.kind='track'
ORDER BY a.id,replace(lower(t.external_id),'-',''),t.id
) INSERT INTO media_relationships(parent_id,child_id,kind,position)
SELECT id,work_id,'contains',min(position)::integer FROM members GROUP BY id,work_id;
--> statement-breakpoint
-- The user chose to discard imported aggregates whose AppID provenance is
-- ambiguous, then let normal authoritative jobs repopulate them. Manual game
-- playthroughs/sessions and all music history are untouched.
DELETE FROM provider_job_snapshots snapshot USING provider_connections c
WHERE snapshot.connection_id=c.id AND EXISTS(SELECT 1 FROM game_account_state a WHERE a.account_id=c.sync_account_id
  AND (SELECT count(*) FROM game_external_ids e WHERE e.game_id=a.game_id AND e.provider='steam')<>1);
UPDATE outbox_actions action SET payload=action.payload-'_checkpoint'
FROM provider_connections c WHERE action.connection_id=c.id AND action.kind IN ('steam.sync','steam.achievements')
  AND EXISTS(SELECT 1 FROM game_account_state a WHERE a.account_id=c.sync_account_id
    AND (SELECT count(*) FROM game_external_ids e WHERE e.game_id=a.game_id AND e.provider='steam')<>1);
--> statement-breakpoint
DELETE FROM sync_checkpoints checkpoint USING provider_connections c
WHERE checkpoint.connection_id=c.id AND checkpoint.kind='steam-user' AND EXISTS(
  SELECT 1 FROM game_account_state a WHERE a.account_id=c.sync_account_id
    AND (SELECT count(*) FROM game_external_ids e WHERE e.game_id=a.game_id AND e.provider='steam')<>1);
--> statement-breakpoint
DELETE FROM game_account_state a WHERE (SELECT count(*) FROM game_external_ids e WHERE e.game_id=a.game_id AND e.provider='steam')<>1;
DELETE FROM game_achievements a WHERE a.provider='steam' AND (SELECT count(*) FROM game_external_ids e WHERE e.game_id=a.game_id AND e.provider='steam')<>1;
--> statement-breakpoint
ALTER TABLE game_account_state ADD COLUMN app_id text;
--> statement-breakpoint
UPDATE game_account_state a SET app_id=(SELECT min(external_id) FROM game_external_ids e WHERE e.game_id=a.game_id AND e.provider='steam');
--> statement-breakpoint
ALTER TABLE game_account_state ALTER COLUMN app_id SET NOT NULL;
ALTER TABLE game_account_state DROP CONSTRAINT game_account_state_account_id_game_id_pk;
ALTER TABLE game_account_state ADD CONSTRAINT game_account_state_account_id_app_id_pk PRIMARY KEY(account_id,app_id);
--> statement-breakpoint
ALTER TABLE game_achievements ADD COLUMN app_id text;
--> statement-breakpoint
UPDATE game_achievements a SET app_id=(SELECT min(external_id) FROM game_external_ids e WHERE e.game_id=a.game_id AND e.provider='steam');
--> statement-breakpoint
ALTER TABLE game_achievements ALTER COLUMN app_id SET NOT NULL;
DROP INDEX game_achievement_identity_unique;
CREATE UNIQUE INDEX game_achievement_identity_unique ON game_achievements(game_id,provider,app_id,external_id);
