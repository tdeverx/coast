CREATE TABLE "benchmark_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action_id" uuid,
	"workload_version" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"context" jsonb,
	"measurements" jsonb,
	"comparison_key" text,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "benchmark_state_check" CHECK ("benchmark_runs"."state" in ('queued','running','completed','failed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "content_revision_changes" (
	"transaction_id" bigint PRIMARY KEY NOT NULL,
	"changes" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_revisions" (
	"scope" text NOT NULL,
	"domain" text NOT NULL,
	"revision" bigint NOT NULL,
	CONSTRAINT "content_revisions_scope_domain_pk" PRIMARY KEY("scope","domain")
);
--> statement-breakpoint
ALTER TABLE "benchmark_runs" ADD CONSTRAINT "benchmark_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_runs" ADD CONSTRAINT "benchmark_runs_action_id_outbox_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."outbox_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "benchmark_one_active_idx" ON "benchmark_runs" USING btree ((true)) WHERE "benchmark_runs"."state" in ('queued','running');--> statement-breakpoint
CREATE INDEX "benchmark_history_idx" ON "benchmark_runs" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "benchmark_comparison_idx" ON "benchmark_runs" USING btree ("comparison_key","created_at");--> statement-breakpoint
CREATE INDEX "benchmark_dataset_comparison_idx" ON "benchmark_runs" USING btree ("comparison_key",("context"->>'datasetFingerprint'),"created_at");
--> statement-breakpoint
-- A statement trigger bumps each affected account once, including bulk imports.
-- A transaction identifier avoids repeat counter writes within the same import.
CREATE FUNCTION coast_bump_content_revision(target_scope text, target_domain text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO content_revision_changes(transaction_id,changes) VALUES(txid_current(),jsonb_build_object(target_scope||':'||target_domain,true))
 ON CONFLICT(transaction_id) DO UPDATE SET changes=content_revision_changes.changes||excluded.changes
 WHERE NOT content_revision_changes.changes ? (target_scope||':'||target_domain);
$$;
--> statement-breakpoint
CREATE FUNCTION coast_flush_content_revisions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pending jsonb; entry text; target_scope text; target_domain text;
BEGIN
 DELETE FROM content_revision_changes WHERE transaction_id=NEW.transaction_id RETURNING changes INTO pending;
 IF pending IS NULL THEN RETURN NULL; END IF;
 FOR entry IN SELECT jsonb_object_keys(pending) ORDER BY 1 LOOP
  target_scope:=split_part(entry,':',1); target_domain:=split_part(entry,':',2);
  IF target_scope<>'global' AND NOT EXISTS(SELECT 1 FROM users WHERE id=target_scope::uuid) THEN
   DELETE FROM content_revisions WHERE scope=target_scope;
   CONTINUE;
  END IF;
  INSERT INTO content_revisions(scope,domain,revision) VALUES(target_scope,target_domain,1)
   ON CONFLICT(scope,domain) DO UPDATE SET revision=content_revisions.revision+1;
 END LOOP;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER content_revision_commit AFTER INSERT OR UPDATE ON content_revision_changes
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION coast_flush_content_revisions();
--> statement-breakpoint
CREATE FUNCTION coast_content_revision_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_rows text; owner record; target_domain text; public_changed boolean;
BEGIN
 source_rows := CASE TG_OP WHEN 'INSERT' THEN 'select * from new_rows' WHEN 'DELETE' THEN 'select * from old_rows'
   ELSE '(select * from new_rows except select * from old_rows) union all (select * from old_rows except select * from new_rows)' END;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='provider_connections' THEN
  source_rows := 'select n.* from new_rows n join old_rows o using(id) where ((to_jsonb(n)-''credentials''-''updated_at'') || jsonb_build_object(''settings'',n.settings-''userSync''-''requestsVerifiedAt'')) is distinct from ((to_jsonb(o)-''credentials''-''updated_at'') || jsonb_build_object(''settings'',o.settings-''userSync''-''requestsVerifiedAt'')) union all select o.* from new_rows n join old_rows o using(id) where ((to_jsonb(n)-''credentials''-''updated_at'') || jsonb_build_object(''settings'',n.settings-''userSync''-''requestsVerifiedAt'')) is distinct from ((to_jsonb(o)-''credentials''-''updated_at'') || jsonb_build_object(''settings'',o.settings-''userSync''-''requestsVerifiedAt''))';
 ELSIF TG_OP='UPDATE' AND TG_TABLE_NAME='provider_instances' THEN
  source_rows := 'select n.* from new_rows n join old_rows o using(id) where ((to_jsonb(n)-''credentials'') || jsonb_build_object(''settings'',n.settings-''libraryScan'')) is distinct from ((to_jsonb(o)-''credentials'') || jsonb_build_object(''settings'',o.settings-''libraryScan'')) union all select o.* from new_rows n join old_rows o using(id) where ((to_jsonb(n)-''credentials'') || jsonb_build_object(''settings'',n.settings-''libraryScan'')) is distinct from ((to_jsonb(o)-''credentials'') || jsonb_build_object(''settings'',o.settings-''libraryScan''))';
 ELSIF TG_OP='UPDATE' AND TG_TABLE_NAME='sync_checkpoints' THEN
  source_rows := 'select n.* from new_rows n join old_rows o using(connection_id,kind) where row(n.scan_id,n.completed_at) is distinct from row(o.scan_id,o.completed_at) union all select o.* from new_rows n join old_rows o using(connection_id,kind) where row(n.scan_id,n.completed_at) is distinct from row(o.scan_id,o.completed_at)';
 ELSIF TG_OP='UPDATE' AND TG_TABLE_NAME='provider_items' THEN
  source_rows := 'select n.* from new_rows n join old_rows o using(id) where ((to_jsonb(n)-''last_seen_at'') || jsonb_build_object(''snapshot'',n.snapshot-''coastUserData'')) is distinct from ((to_jsonb(o)-''last_seen_at'') || jsonb_build_object(''snapshot'',o.snapshot-''coastUserData'')) union all select o.* from new_rows n join old_rows o using(id) where ((to_jsonb(n)-''last_seen_at'') || jsonb_build_object(''snapshot'',n.snapshot-''coastUserData'')) is distinct from ((to_jsonb(o)-''last_seen_at'') || jsonb_build_object(''snapshot'',o.snapshot-''coastUserData''))';
 ELSIF TG_OP='UPDATE' AND TG_TABLE_NAME='sync_accounts' THEN
  source_rows := 'select n.* from new_rows n where not exists(select 1 from old_rows o where (to_jsonb(n)-''verified_at''-''baselines'')=(to_jsonb(o)-''verified_at''-''baselines'')) union all select o.* from old_rows o where not exists(select 1 from new_rows n where (to_jsonb(n)-''verified_at''-''baselines'')=(to_jsonb(o)-''verified_at''-''baselines''))';
 ELSIF TG_OP='UPDATE' AND TG_TABLE_NAME='game_account_state' THEN
  source_rows := 'select n.* from new_rows n where not exists(select 1 from old_rows o where (to_jsonb(n)-''observed_at''-''achievements_attempted_at'')=(to_jsonb(o)-''observed_at''-''achievements_attempted_at'')) union all select o.* from old_rows o where not exists(select 1 from new_rows n where (to_jsonb(n)-''observed_at''-''achievements_attempted_at'')=(to_jsonb(o)-''observed_at''-''achievements_attempted_at''))';
 ELSIF TG_OP='UPDATE' AND TG_TABLE_NAME='game_achievement_progress' THEN
  source_rows := 'select n.* from new_rows n where not exists(select 1 from old_rows o where (to_jsonb(n)-''updated_at'')=(to_jsonb(o)-''updated_at'')) union all select o.* from old_rows o where not exists(select 1 from new_rows n where (to_jsonb(n)-''updated_at'')=(to_jsonb(o)-''updated_at''))';
 ELSIF TG_OP='UPDATE' AND TG_TABLE_NAME IN ('media','games','metadata_snapshots','metadata_overrides') THEN
  source_rows := 'select n.* from new_rows n join old_rows o using(id) where (to_jsonb(n)-''updated_at'') is distinct from (to_jsonb(o)-''updated_at'') union all select o.* from new_rows n join old_rows o using(id) where (to_jsonb(n)-''updated_at'') is distinct from (to_jsonb(o)-''updated_at'')';
 END IF;
 IF TG_TABLE_NAME='metadata_overrides' AND TG_OP='UPDATE' THEN
  source_rows:=replace(source_rows,'using(id)','using(media_id)');
 END IF;
 IF TG_TABLE_NAME='social_live_state' AND TG_OP='UPDATE' THEN
  source_rows := 'select n.* from new_rows n join old_rows o using(connection_id) where row(n.account_generation,n.work_id,coalesce(n.expires_at>now(),false)) is distinct from row(o.account_generation,o.work_id,coalesce(o.expires_at>now(),false)) union all select o.* from new_rows n join old_rows o using(connection_id) where row(n.account_generation,n.work_id,coalesce(n.expires_at>now(),false)) is distinct from row(o.account_generation,o.work_id,coalesce(o.expires_at>now(),false))';
 END IF;
 FOR owner IN EXECUTE format('with changed as (%s) select distinct scope from (%s) owners where scope is not null order by scope',source_rows,TG_ARGV[1]) LOOP
  FOREACH target_domain IN ARRAY string_to_array(TG_ARGV[0],',') LOOP
   PERFORM coast_bump_content_revision(owner.scope,target_domain);
  END LOOP;
 END LOOP;
 -- Work reaction badges include public non-friends. Only public reaction writes
 -- and transitions in a potentially public reaction policy need global scope.
 IF TG_TABLE_NAME='social_reactions' THEN
  EXECUTE format('with changed as (%s) select exists(select 1 from changed c left join social_activity a on c.target_kind=''activity'' and a.id=c.target_id join works w on w.id=case when c.target_kind=''work'' then c.target_id else a.work_id end where social_visible(c.user_id,null::uuid,''reactions'',w.category))',source_rows) INTO public_changed;
 ELSIF TG_TABLE_NAME='users' THEN
  public_changed:=true;
  IF TG_OP='UPDATE' THEN
   SELECT EXISTS(SELECT 1 FROM new_rows n JOIN old_rows o USING(id) WHERE row(n.disabled,n.settings->'social') IS DISTINCT FROM row(o.disabled,o.settings->'social')) INTO public_changed;
  END IF;
  IF public_changed THEN
   EXECUTE format('with changed as (%s) select exists(select 1 from changed where not disabled and coalesce(settings->''social''->>''audience'',''friends'')<>''private'' and coalesce(settings->''social''->''sections''->>''reactions'',settings->''social''->>''audience'',''friends'')=''public'')',source_rows) INTO public_changed;
  END IF;
 END IF;
 IF public_changed THEN PERFORM coast_bump_content_revision('global','social'); END IF;
 RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_content_insert AFTER INSERT ON users REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER users_content_update AFTER UPDATE ON users REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER users_content_delete AFTER DELETE ON users REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER friendships_content_insert AFTER INSERT ON friendships REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('social','select user_a::text as scope from changed union select user_b::text from changed');
--> statement-breakpoint
CREATE TRIGGER friendships_content_update AFTER UPDATE ON friendships REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('social','select user_a::text as scope from changed union select user_b::text from changed');
--> statement-breakpoint
CREATE TRIGGER friendships_content_delete AFTER DELETE ON friendships REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('social','select user_a::text as scope from changed union select user_b::text from changed');
--> statement-breakpoint
CREATE TRIGGER social_recommendations_content_insert AFTER INSERT ON social_recommendations REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('social','select sender_id::text as scope from changed union select recipient_id::text from changed');
--> statement-breakpoint
CREATE TRIGGER social_recommendations_content_update AFTER UPDATE ON social_recommendations REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('social','select sender_id::text as scope from changed union select recipient_id::text from changed');
--> statement-breakpoint
CREATE TRIGGER social_recommendations_content_delete AFTER DELETE ON social_recommendations REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('social','select sender_id::text as scope from changed union select recipient_id::text from changed');
--> statement-breakpoint
CREATE TRIGGER list_items_content_insert AFTER INSERT ON list_items REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select l.user_id::text as scope from changed c join lists l on l.id=c.list_id');
--> statement-breakpoint
CREATE TRIGGER list_items_content_update AFTER UPDATE ON list_items REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select l.user_id::text as scope from changed c join lists l on l.id=c.list_id');
--> statement-breakpoint
CREATE TRIGGER list_items_content_delete AFTER DELETE ON list_items REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select l.user_id::text as scope from changed c join lists l on l.id=c.list_id');
--> statement-breakpoint
CREATE TRIGGER game_sessions_content_insert AFTER INSERT ON game_sessions REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select p.user_id::text as scope from changed c join game_playthroughs p on p.id=c.playthrough_id');
--> statement-breakpoint
CREATE TRIGGER game_sessions_content_update AFTER UPDATE ON game_sessions REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select p.user_id::text as scope from changed c join game_playthroughs p on p.id=c.playthrough_id');
--> statement-breakpoint
CREATE TRIGGER game_sessions_content_delete AFTER DELETE ON game_sessions REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select p.user_id::text as scope from changed c join game_playthroughs p on p.id=c.playthrough_id');
--> statement-breakpoint
CREATE TRIGGER sync_checkpoints_content_insert AFTER INSERT ON sync_checkpoints REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select p.user_id::text as scope from changed c join provider_connections p on p.id=c.connection_id');
--> statement-breakpoint
CREATE TRIGGER sync_checkpoints_content_update AFTER UPDATE ON sync_checkpoints REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select p.user_id::text as scope from changed c join provider_connections p on p.id=c.connection_id');
--> statement-breakpoint
CREATE TRIGGER sync_checkpoints_content_delete AFTER DELETE ON sync_checkpoints REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select p.user_id::text as scope from changed c join provider_connections p on p.id=c.connection_id');
--> statement-breakpoint
CREATE TRIGGER social_live_state_content_insert AFTER INSERT ON social_live_state REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('social','select p.user_id::text as scope from changed c join provider_connections p on p.id=c.connection_id');
--> statement-breakpoint
CREATE TRIGGER social_live_state_content_update AFTER UPDATE ON social_live_state REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('social','select p.user_id::text as scope from changed c join provider_connections p on p.id=c.connection_id');
--> statement-breakpoint
CREATE TRIGGER social_live_state_content_delete AFTER DELETE ON social_live_state REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('social','select p.user_id::text as scope from changed c join provider_connections p on p.id=c.connection_id');
--> statement-breakpoint
CREATE TRIGGER tracking_state_content_insert AFTER INSERT ON tracking_state REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER tracking_state_content_update AFTER UPDATE ON tracking_state REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER tracking_state_content_delete AFTER DELETE ON tracking_state REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER tracking_events_content_insert AFTER INSERT ON tracking_events REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER tracking_events_content_update AFTER UPDATE ON tracking_events REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER tracking_events_content_delete AFTER DELETE ON tracking_events REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER ratings_content_insert AFTER INSERT ON ratings REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER ratings_content_update AFTER UPDATE ON ratings REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER ratings_content_delete AFTER DELETE ON ratings REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER up_next_content_insert AFTER INSERT ON up_next REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER up_next_content_update AFTER UPDATE ON up_next REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER up_next_content_delete AFTER DELETE ON up_next REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER rewatches_content_insert AFTER INSERT ON rewatches REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER rewatches_content_update AFTER UPDATE ON rewatches REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER rewatches_content_delete AFTER DELETE ON rewatches REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER lists_content_insert AFTER INSERT ON lists REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER lists_content_update AFTER UPDATE ON lists REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER lists_content_delete AFTER DELETE ON lists REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER music_listens_content_insert AFTER INSERT ON music_listens REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER music_listens_content_update AFTER UPDATE ON music_listens REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER music_listens_content_delete AFTER DELETE ON music_listens REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER music_progress_content_insert AFTER INSERT ON music_progress REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER music_progress_content_update AFTER UPDATE ON music_progress REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER music_progress_content_delete AFTER DELETE ON music_progress REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER music_artist_preferences_content_insert AFTER INSERT ON music_artist_preferences REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER music_artist_preferences_content_update AFTER UPDATE ON music_artist_preferences REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER music_artist_preferences_content_delete AFTER DELETE ON music_artist_preferences REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER game_playthroughs_content_insert AFTER INSERT ON game_playthroughs REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER game_playthroughs_content_update AFTER UPDATE ON game_playthroughs REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER game_playthroughs_content_delete AFTER DELETE ON game_playthroughs REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER availability_content_insert AFTER INSERT ON availability REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER availability_content_update AFTER UPDATE ON availability REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER availability_content_delete AFTER DELETE ON availability REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER provider_connections_content_insert AFTER INSERT ON provider_connections REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER provider_connections_content_update AFTER UPDATE ON provider_connections REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER provider_connections_content_delete AFTER DELETE ON provider_connections REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER user_metadata_preferences_content_insert AFTER INSERT ON user_metadata_preferences REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER user_metadata_preferences_content_update AFTER UPDATE ON user_metadata_preferences REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER user_metadata_preferences_content_delete AFTER DELETE ON user_metadata_preferences REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER social_activity_content_insert AFTER INSERT ON social_activity REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER social_activity_content_update AFTER UPDATE ON social_activity REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER social_activity_content_delete AFTER DELETE ON social_activity REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER social_reactions_content_insert AFTER INSERT ON social_reactions REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER social_reactions_content_update AFTER UPDATE ON social_reactions REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER social_reactions_content_delete AFTER DELETE ON social_reactions REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER social_checkins_content_insert AFTER INSERT ON social_checkins REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER social_checkins_content_update AFTER UPDATE ON social_checkins REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER social_checkins_content_delete AFTER DELETE ON social_checkins REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER media_plans_content_insert AFTER INSERT ON media_plans REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('planning','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER media_plans_content_update AFTER UPDATE ON media_plans REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('planning','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER media_plans_content_delete AFTER DELETE ON media_plans REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('planning','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER works_content_insert AFTER INSERT ON works REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER works_content_update AFTER UPDATE ON works REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER works_content_delete AFTER DELETE ON works REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER media_content_insert AFTER INSERT ON media REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER media_content_update AFTER UPDATE ON media REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER media_content_delete AFTER DELETE ON media REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER episodes_content_insert AFTER INSERT ON episodes REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER episodes_content_update AFTER UPDATE ON episodes REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER episodes_content_delete AFTER DELETE ON episodes REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER seasons_content_insert AFTER INSERT ON seasons REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER seasons_content_update AFTER UPDATE ON seasons REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER seasons_content_delete AFTER DELETE ON seasons REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER media_relationships_content_insert AFTER INSERT ON media_relationships REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER media_relationships_content_update AFTER UPDATE ON media_relationships REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER media_relationships_content_delete AFTER DELETE ON media_relationships REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER music_works_content_insert AFTER INSERT ON music_works REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER music_works_content_update AFTER UPDATE ON music_works REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER music_works_content_delete AFTER DELETE ON music_works REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER games_content_insert AFTER INSERT ON games REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER games_content_update AFTER UPDATE ON games REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER games_content_delete AFTER DELETE ON games REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER provider_items_content_insert AFTER INSERT ON provider_items REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER provider_items_content_update AFTER UPDATE ON provider_items REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER provider_items_content_delete AFTER DELETE ON provider_items REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER provider_instances_content_insert AFTER INSERT ON provider_instances REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER provider_instances_content_update AFTER UPDATE ON provider_instances REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER provider_instances_content_delete AFTER DELETE ON provider_instances REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER system_settings_content_insert AFTER INSERT ON system_settings REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER system_settings_content_update AFTER UPDATE ON system_settings REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER system_settings_content_delete AFTER DELETE ON system_settings REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER metadata_overrides_content_insert AFTER INSERT ON metadata_overrides REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER metadata_overrides_content_update AFTER UPDATE ON metadata_overrides REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER metadata_overrides_content_delete AFTER DELETE ON metadata_overrides REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER metadata_snapshots_content_insert AFTER INSERT ON metadata_snapshots REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER metadata_snapshots_content_update AFTER UPDATE ON metadata_snapshots REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER metadata_snapshots_content_delete AFTER DELETE ON metadata_snapshots REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed limit 1');
--> statement-breakpoint
CREATE TRIGGER game_account_state_content_insert AFTER INSERT ON game_account_state REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select a.user_id::text as scope from changed c join sync_accounts a on a.id=c.account_id');
--> statement-breakpoint
CREATE TRIGGER game_account_state_content_update AFTER UPDATE ON game_account_state REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select a.user_id::text as scope from changed c join sync_accounts a on a.id=c.account_id');
--> statement-breakpoint
CREATE TRIGGER game_account_state_content_delete AFTER DELETE ON game_account_state REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select a.user_id::text as scope from changed c join sync_accounts a on a.id=c.account_id');
--> statement-breakpoint
CREATE TRIGGER game_achievement_progress_content_insert AFTER INSERT ON game_achievement_progress REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select a.user_id::text as scope from changed c join sync_accounts a on a.id=c.account_id');
--> statement-breakpoint
CREATE TRIGGER game_achievement_progress_content_update AFTER UPDATE ON game_achievement_progress REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select a.user_id::text as scope from changed c join sync_accounts a on a.id=c.account_id');
--> statement-breakpoint
CREATE TRIGGER game_achievement_progress_content_delete AFTER DELETE ON game_achievement_progress REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select a.user_id::text as scope from changed c join sync_accounts a on a.id=c.account_id');

--> statement-breakpoint
CREATE TRIGGER sync_accounts_content_insert AFTER INSERT ON sync_accounts REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');

--> statement-breakpoint
CREATE TRIGGER sync_accounts_content_update AFTER UPDATE ON sync_accounts REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');

--> statement-breakpoint
CREATE TRIGGER sync_accounts_content_delete AFTER DELETE ON sync_accounts REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
