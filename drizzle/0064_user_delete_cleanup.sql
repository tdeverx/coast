-- User deletion cascades through connections and sync accounts in one transaction.
-- Do not build a reconnect archive for the account that is being removed.
-- Ordinary disconnects retain their existing archive and restore behavior.
CREATE OR REPLACE FUNCTION archive_connection_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=OLD.user_id) THEN
    RETURN OLD;
  END IF;
  UPDATE sync_accounts SET settings=OLD.settings,baselines=jsonb_build_object(
    'values',coalesce((SELECT jsonb_agg(to_jsonb(v)) FROM sync_values v WHERE connection_id=OLD.id),'[]'::jsonb),
    'lists',coalesce((SELECT jsonb_agg(to_jsonb(v)) FROM sync_list_values v WHERE connection_id=OLD.id),'[]'::jsonb)) WHERE id=OLD.sync_account_id;
  RETURN OLD;
END $$;

--> statement-breakpoint
-- Remove reactions for a deleted activity set once, including bulk account cleanup.
CREATE OR REPLACE FUNCTION social_clean_activity_reactions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM social_reactions
    WHERE target_kind='activity' AND target_id IN (SELECT id FROM deleted_activity_rows);
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER social_activity_reactions ON social_activity;
--> statement-breakpoint
CREATE TRIGGER social_activity_reactions AFTER DELETE ON social_activity
  REFERENCING OLD TABLE AS deleted_activity_rows
  FOR EACH STATEMENT EXECUTE FUNCTION social_clean_activity_reactions();

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
  IF r->>'status'='planned' OR (TG_OP='UPDATE' AND NEW.status=OLD.status) THEN RETURN NEW; END IF;
 END IF;
 IF source_name<>'coast' THEN
  SELECT a.id::text INTO batch_key FROM outbox_actions a WHERE a.user_id=owner_id AND a.state='running' AND a.kind IN ('trakt.import','jellyfin.sync') AND (r->>'source_event_id' IS NULL OR (r->>'source_event_id') LIKE a.connection_id::text||':%') ORDER BY a.created_at DESC LIMIT 1;
 END IF;
 INSERT INTO social_activity(user_id,work_id,event_kind,section,source,source_key,batch_key,date_known,occurred_at)
 VALUES(owner_id,work_id,event_kind,visibility_section,source_name,event_key,batch_key,known,event_date)
 ON CONFLICT(user_id,source_key) DO UPDATE SET occurred_at=EXCLUDED.occurred_at,event_kind=EXCLUDED.event_kind,date_known=EXCLUDED.date_known;
 RETURN NEW;
END $$;
