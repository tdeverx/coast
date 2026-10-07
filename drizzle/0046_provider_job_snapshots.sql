CREATE TABLE provider_job_snapshots (
 action_id uuid PRIMARY KEY REFERENCES outbox_actions(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
 account_generation uuid NOT NULL,
 data jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX provider_job_snapshot_retention_idx ON provider_job_snapshots(updated_at);
--> statement-breakpoint
CREATE FUNCTION prune_provider_job_snapshots() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state IN ('succeeded','cancelled') THEN DELETE FROM provider_job_snapshots WHERE action_id=NEW.id; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER provider_job_snapshot_terminal AFTER UPDATE OF state ON outbox_actions FOR EACH ROW EXECUTE FUNCTION prune_provider_job_snapshots();
--> statement-breakpoint
CREATE FUNCTION prune_provider_connection_snapshots() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.account_generation IS DISTINCT FROM OLD.account_generation OR NEW.status<>'connected' THEN
   DELETE FROM provider_job_snapshots WHERE connection_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER provider_job_snapshot_reset AFTER UPDATE OF account_generation,status ON provider_connections FOR EACH ROW EXECUTE FUNCTION prune_provider_connection_snapshots();
