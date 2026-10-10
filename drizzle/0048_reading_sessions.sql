ALTER TABLE reading_works ADD COLUMN release_date date, ADD COLUMN edition_ids text[] NOT NULL DEFAULT '{}' CHECK(cardinality(edition_ids)<=100);
--> statement-breakpoint
CREATE TABLE reading_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 work_id uuid NOT NULL REFERENCES reading_works(id) ON DELETE CASCADE,
 connection_id uuid REFERENCES provider_connections(id) ON DELETE CASCADE,
 account_generation uuid,
 external_id text,
 format text NOT NULL CHECK(format IN ('pdf','epub','cbz')),
 edition text NOT NULL CHECK(length(edition) BETWEEN 1 AND 200),
 location jsonb,
 expires_at timestamptz NOT NULL,
 closed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((connection_id IS NULL)=(external_id IS NULL)),
 CHECK(connection_id IS NULL OR account_generation IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX reading_sessions_resume_idx ON reading_sessions(user_id,work_id,edition,updated_at);
--> statement-breakpoint
CREATE INDEX reading_sessions_expiry_idx ON reading_sessions(expires_at);
--> statement-breakpoint
CREATE TABLE reading_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 work_id uuid NOT NULL REFERENCES reading_works(id) ON DELETE CASCADE,
 state text NOT NULL CHECK(state IN ('planned','reading','completed','paused','dropped')),
 page integer NOT NULL CHECK(page BETWEEN 0 AND 1000000),
 total_pages integer CHECK(total_pages BETWEEN 1 AND 1000000 AND page<=total_pages),
 occurred_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX reading_history_user_work_idx ON reading_history(user_id,work_id,occurred_at,id);
--> statement-breakpoint
CREATE FUNCTION coast_reading_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_id uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW.state=OLD.state THEN RETURN NEW; END IF;
 INSERT INTO reading_history(user_id,work_id,state,page,total_pages,occurred_at)
 VALUES(NEW.user_id,NEW.work_id,NEW.state,NEW.page,NEW.total_pages,NEW.updated_at) RETURNING id INTO event_id;
 INSERT INTO social_activity(user_id,work_id,event_kind,section,source,source_key,date_known,occurred_at)
 VALUES(NEW.user_id,NEW.work_id,'reading-'||NEW.state,'progress','coast','reading:'||event_id,true,NEW.updated_at);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER reading_progress_history AFTER INSERT OR UPDATE ON reading_progress FOR EACH ROW EXECUTE FUNCTION coast_reading_history();
--> statement-breakpoint
ALTER TABLE synced_rooms ADD COLUMN reading jsonb;
--> statement-breakpoint
ALTER TABLE synced_participants ADD COLUMN reading_session_id uuid REFERENCES reading_sessions(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE synced_rooms ADD COLUMN reading_format text CHECK (reading_format IN ('pdf','epub','cbz'));
