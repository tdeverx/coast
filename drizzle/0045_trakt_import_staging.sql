CREATE TABLE trakt_import_stages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 action_id uuid NOT NULL REFERENCES outbox_actions(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
 account_generation uuid NOT NULL,
 category text NOT NULL,
 phase text NOT NULL DEFAULT 'fetching',
 next_page integer NOT NULL DEFAULT 1,
 activity text NOT NULL,
 restarts integer NOT NULL DEFAULT 0,
 cleaned_through uuid,
 imported integer NOT NULL DEFAULT 0,
 review integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX trakt_import_stage_action_unique ON trakt_import_stages(action_id,category);
--> statement-breakpoint
CREATE INDEX trakt_import_stage_retention_idx ON trakt_import_stages(updated_at);
--> statement-breakpoint
CREATE TABLE trakt_import_records (
 stage_id uuid NOT NULL REFERENCES trakt_import_stages(id) ON DELETE CASCADE,
 ordinal integer NOT NULL,
 sort_key text COLLATE "C" NOT NULL,
 record jsonb NOT NULL,
 applied boolean NOT NULL DEFAULT false,
 observed_media_id uuid,
 PRIMARY KEY(stage_id,ordinal)
);
--> statement-breakpoint
CREATE INDEX trakt_import_records_apply_idx ON trakt_import_records(stage_id,sort_key,ordinal) WHERE NOT applied;
--> statement-breakpoint
CREATE INDEX trakt_import_records_observed_idx ON trakt_import_records(stage_id,observed_media_id);
--> statement-breakpoint
CREATE FUNCTION prune_trakt_action_staging() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state IN ('succeeded','cancelled') THEN DELETE FROM trakt_import_stages WHERE action_id=NEW.id; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trakt_action_staging_terminal AFTER UPDATE OF state ON outbox_actions FOR EACH ROW EXECUTE FUNCTION prune_trakt_action_staging();
--> statement-breakpoint
CREATE FUNCTION prune_trakt_connection_staging() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.account_generation IS DISTINCT FROM OLD.account_generation OR NEW.status<>'connected' THEN
   DELETE FROM trakt_import_stages WHERE connection_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trakt_connection_staging_reset AFTER UPDATE OF account_generation,status ON provider_connections FOR EACH ROW EXECUTE FUNCTION prune_trakt_connection_staging();
