ALTER TABLE "tracking_events" ADD COLUMN "merged_into" uuid;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_merged_into_tracking_events_id_fk" FOREIGN KEY ("merged_into") REFERENCES "public"."tracking_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tracking_merged_event_idx" ON "tracking_events" USING btree ("merged_into") WHERE "tracking_events"."merged_into" is not null;
--> statement-breakpoint
-- Reuse the owner and source key index when an imported observation is hidden.
CREATE OR REPLACE FUNCTION social_project_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r jsonb; owner_id uuid; work_id uuid; event_kind text; visibility_section text; source_name text; event_key text; batch_key text; event_date timestamptz; known boolean;
BEGIN
 r:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 event_key:=TG_TABLE_NAME||':'||COALESCE(r->>'id',(r->>'user_id')||':'||(r->>'media_id'));
 IF TG_OP='DELETE' THEN
  -- The same user cascade removes every owned activity. Avoid per-event
  -- projection deletes after its owner has already been removed.
  IF r ? 'user_id' AND NOT EXISTS(SELECT 1 FROM users WHERE id=(r->>'user_id')::uuid) THEN RETURN OLD; END IF;
  DELETE FROM social_activity WHERE source_key=event_key;
  RETURN OLD;
 END IF;
 owner_id:=(r->>'user_id')::uuid; work_id:=COALESCE(r->>'media_id',r->>'track_id',r->>'game_id')::uuid;
 source_name:=COALESCE(r->>'source','coast'); event_date:=COALESCE(r->>'occurred_at',r->>'played_at',r->>'updated_at',r->>'created_at')::timestamptz;
 known:=COALESCE((r->>'occurred_at_known')::boolean,true); visibility_section:='activity';
 IF TG_TABLE_NAME='tracking_events' THEN
  event_kind:=r->>'action';
  IF NOT (r->>'applied')::boolean OR event_kind NOT IN ('watch','watchlist','favourite','collect','drop','restore') OR (event_kind IN ('watchlist','favourite','collect') AND NOT COALESCE((r->>'value')::boolean,true)) THEN
   DELETE FROM social_activity WHERE user_id=owner_id AND source_key=event_key; RETURN NEW;
  END IF;
  visibility_section:=CASE event_kind WHEN 'watchlist' THEN 'collection' WHEN 'collect' THEN 'collection' WHEN 'favourite' THEN 'favourites' ELSE 'activity' END;
 ELSIF TG_TABLE_NAME='ratings' THEN
  event_kind:='rating'; visibility_section:='ratings';
  IF TG_OP='UPDATE' AND NEW.value=OLD.value THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='music_listens' THEN event_kind:='listen'; batch_key:=r->>'batch_id';
 ELSIF TG_TABLE_NAME='game_sessions' THEN
  SELECT p.user_id,p.game_id INTO owner_id,work_id FROM game_playthroughs p WHERE p.id=(r->>'playthrough_id')::uuid;
  event_kind:='played';
 ELSIF TG_TABLE_NAME='game_playthroughs' THEN
  event_kind:='game-'||(r->>'status');
  IF r->>'status'='planned' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.status=OLD.status
    AND (NEW.status<>'completed' OR NEW.completed_at IS NOT DISTINCT FROM OLD.completed_at) THEN RETURN NEW; END IF;
  IF event_kind='game-completed' THEN event_date:=COALESCE((r->>'completed_at')::timestamptz,event_date); END IF;
 END IF;
 IF source_name<>'coast' THEN
  SELECT a.id::text INTO batch_key FROM outbox_actions a WHERE a.user_id=owner_id AND a.state='running' AND a.kind IN ('trakt.import','jellyfin.sync') AND (r->>'source_event_id' IS NULL OR (r->>'source_event_id') LIKE a.connection_id::text||':%') ORDER BY a.created_at DESC LIMIT 1;
 END IF;
 INSERT INTO social_activity(user_id,work_id,event_kind,section,source,source_key,batch_key,date_known,occurred_at)
 VALUES(owner_id,work_id,event_kind,visibility_section,source_name,event_key,batch_key,known,event_date)
 ON CONFLICT(user_id,source_key) DO UPDATE SET occurred_at=EXCLUDED.occurred_at,event_kind=EXCLUDED.event_kind,date_known=EXCLUDED.date_known;
 RETURN NEW;
END $$;
--> statement-breakpoint
-- Earlier imports incremented the play count for a Trakt observation of a
-- Jellyfin watch. Keep its identity and pair only one observation per source.
WITH observations AS (
  SELECT e.id, e.user_id, e.media_id, e.occurred_at, e.source, e.created_at,
    row_number() OVER (
      PARTITION BY e.user_id, e.media_id, e.occurred_at, e.source
      ORDER BY e.created_at, e.id
    ) AS occurrence
  FROM tracking_events e
  WHERE e.applied AND e.occurred_at_known AND e.action = 'watch'
    AND (e.source = 'jellyfin' OR (e.source = 'trakt' AND e.rewatch))
), merged AS (
  UPDATE tracking_events e
  SET applied = false, merged_into = jf.id
  FROM observations tr
  JOIN observations jf USING (user_id, media_id, occurred_at, occurrence)
  WHERE e.id = tr.id AND tr.source = 'trakt' AND jf.source = 'jellyfin'
    AND (jf.created_at, jf.id) < (tr.created_at, tr.id)
    -- A later watch can be an explicit restoration of a previously cleared state.
    AND NOT EXISTS (
      SELECT 1 FROM tracking_events cleared
      WHERE cleared.user_id = tr.user_id AND cleared.media_id = tr.media_id
        AND cleared.applied AND cleared.action = 'unwatch'
        AND (cleared.created_at, cleared.id) > (jf.created_at, jf.id)
        AND (cleared.created_at, cleared.id) < (tr.created_at, tr.id)
    )
  RETURNING e.user_id, e.media_id
), corrections AS (
  SELECT user_id, media_id, count(*)::integer AS copies FROM merged GROUP BY user_id, media_id
)
UPDATE tracking_state state
SET play_count = greatest(
  state.play_count - corrections.copies,
  CASE WHEN state.watched THEN 1 ELSE 0 END,
  -- Jellyfin's cumulative count can include distinct plays for which it never
  -- supplied a timestamp. Preserve the persisted floor without raising counts.
  least(state.play_count, coalesce((
    SELECT max((a.source->'coastUserData'->>'playCount')::integer)
    FROM availability a
    JOIN provider_connections c ON c.id = a.connection_id
    JOIN provider_instances i ON i.id = c.instance_id AND i.provider = 'jellyfin'
    WHERE a.user_id = state.user_id AND a.media_id = state.media_id
      AND jsonb_typeof(a.source->'coastUserData'->'playCount') = 'number'
  ), 0))
)
FROM corrections
WHERE state.user_id = corrections.user_id AND state.media_id = corrections.media_id;
