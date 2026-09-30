ALTER TABLE "music_progress" ADD COLUMN "play_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_accounts" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_accounts" ADD COLUMN "baselines" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE sync_accounts a SET settings=c.settings FROM provider_connections c WHERE c.sync_account_id=a.id;
--> statement-breakpoint
UPDATE music_progress p SET play_count=(SELECT count(*) FROM music_listens l WHERE l.user_id=p.user_id AND l.track_id=p.track_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION update_connection_account() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE server_key text; account_key uuid; stored_settings jsonb; stored_baselines jsonb; switched boolean;
BEGIN
  switched=TG_OP='UPDATE' AND OLD.external_user_id IS DISTINCT FROM NEW.external_user_id AND NEW.external_user_id IS NOT NULL;
  IF switched THEN
    IF OLD.sync_account_id IS NOT NULL THEN
      UPDATE sync_accounts SET settings=OLD.settings,baselines=jsonb_build_object(
        'values',coalesce((SELECT jsonb_agg(to_jsonb(v)) FROM sync_values v WHERE connection_id=OLD.id),'[]'::jsonb),
        'lists',coalesce((SELECT jsonb_agg(to_jsonb(v)) FROM sync_list_values v WHERE connection_id=OLD.id),'[]'::jsonb)) WHERE id=OLD.sync_account_id;
    END IF;
    NEW.account_generation=gen_random_uuid();
    DELETE FROM sync_checkpoints WHERE connection_id=OLD.id;
    DELETE FROM sync_values WHERE connection_id=OLD.id;
    DELETE FROM sync_list_values WHERE connection_id=OLD.id;
    DELETE FROM reconciliation_intents WHERE connection_id=OLD.id;
    UPDATE availability SET state='unknown' WHERE connection_id=OLD.id;
    UPDATE outbox_actions SET state='cancelled',updated_at=now() WHERE connection_id=OLD.id AND state IN ('pending','failed','running');
  END IF;
  IF NEW.external_user_id IS NOT NULL THEN
    SELECT coalesce(server_identity,id::text) INTO server_key FROM provider_instances WHERE id=NEW.instance_id;
    SELECT id,settings,baselines INTO account_key,stored_settings,stored_baselines FROM sync_accounts
      WHERE user_id=NEW.user_id AND instance_id=NEW.instance_id AND server_identity=server_key AND external_user_id=NEW.external_user_id;
    IF account_key IS NULL THEN
      INSERT INTO sync_accounts(user_id,instance_id,server_identity,external_user_id,settings) VALUES(NEW.user_id,NEW.instance_id,server_key,NEW.external_user_id,NEW.settings) RETURNING id INTO account_key;
    ELSE
      UPDATE sync_accounts SET verified_at=now() WHERE id=account_key;
      IF switched THEN
        NEW.settings=stored_settings;
        INSERT INTO sync_values(id,connection_id,account_id,media_id,category,remote,agreed,conflict,updated_at)
          SELECT gen_random_uuid(),NEW.id,account_key,x.media_id,x.category,x.remote,x.agreed,x.conflict,x.updated_at FROM jsonb_populate_recordset(NULL::sync_values,coalesce(stored_baselines->'values','[]'::jsonb)) x JOIN works w ON w.id=x.media_id;
        INSERT INTO sync_list_values(id,connection_id,account_id,list_id,remote,agreed,conflict,updated_at)
          SELECT gen_random_uuid(),NEW.id,account_key,x.list_id,x.remote,x.agreed,x.conflict,x.updated_at FROM jsonb_populate_recordset(NULL::sync_list_values,coalesce(stored_baselines->'lists','[]'::jsonb)) x JOIN lists l ON l.id=x.list_id;
      END IF;
    END IF;
    NEW.sync_account_id=account_key;
  END IF;
  RETURN NEW;
END $$;
