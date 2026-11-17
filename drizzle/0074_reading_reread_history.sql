DROP INDEX "reading_sessions_resume_idx";--> statement-breakpoint
ALTER TABLE "reading_progress" ADD COLUMN "bookmark_cycle" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD COLUMN "reread_restore" jsonb;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD COLUMN "bookmark_cycle" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
CREATE INDEX "reading_sessions_resume_idx" ON "reading_sessions" USING btree ("user_id","work_id","bookmark_cycle","edition","updated_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION coast_reading_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_id uuid; event_date timestamptz;
BEGIN
 IF TG_OP='UPDATE' THEN
  -- Ending an unfinished reread restores the previous completion without recording it twice.
  IF OLD.reread_restore IS NOT NULL AND NEW.reread_restore IS NULL
      AND NEW.state='completed'
      AND NEW.bookmark_cycle=(OLD.reread_restore->>'bookmarkCycle')::uuid THEN RETURN NEW; END IF;
  IF NEW.state=OLD.state THEN
   IF NEW.state<>'completed' OR NEW.completed_at IS NOT DISTINCT FROM OLD.completed_at THEN RETURN NEW; END IF;
   -- A completion date correction updates the same history and activity entries.
   UPDATE reading_history SET occurred_at=NEW.completed_at WHERE id=(
     SELECT id FROM reading_history WHERE user_id=NEW.user_id AND work_id=NEW.work_id
      AND state='completed' AND occurred_at=OLD.completed_at ORDER BY id DESC LIMIT 1
   ) RETURNING id INTO event_id;
   IF event_id IS NOT NULL THEN
    UPDATE social_activity SET occurred_at=NEW.completed_at
     WHERE user_id=NEW.user_id AND source_key='reading:'||event_id;
    RETURN NEW;
   END IF;
  END IF;
 END IF;
 event_date:=NEW.updated_at;
 IF NEW.state='completed' THEN event_date:=NEW.completed_at;
 ELSIF TG_OP='UPDATE' AND NEW.reread_restore IS NOT NULL AND NEW.bookmark_cycle IS DISTINCT FROM OLD.bookmark_cycle
 THEN event_date:=NEW.started_at;
 END IF;
 INSERT INTO reading_history(user_id,work_id,state,page,total_pages,occurred_at)
 VALUES(NEW.user_id,NEW.work_id,NEW.state,NEW.page,NEW.total_pages,event_date) RETURNING id INTO event_id;
 INSERT INTO social_activity(user_id,work_id,event_kind,section,source,source_key,date_known,occurred_at)
 VALUES(NEW.user_id,NEW.work_id,'reading-'||NEW.state,'progress','coast','reading:'||event_id,true,event_date);
 RETURN NEW;
END $$;
--> statement-breakpoint
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
   DELETE FROM social_activity WHERE source_key=event_key; RETURN NEW;
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
