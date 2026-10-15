CREATE TABLE reading_works (
 id uuid PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
 provider text NOT NULL,
 external_id text NOT NULL,
 kind text NOT NULL,
 title text NOT NULL,
 overview text,
 cover_url text,
 source_url text NOT NULL,
 authors text[] NOT NULL DEFAULT '{}',
 subjects text[] NOT NULL DEFAULT '{}',
 published_year integer,
 page_count integer,
 series_title text,
 issue_number text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT reading_works_provider_kind_check CHECK ((provider='openlibrary' AND kind='book') OR (provider='comic-vine' AND kind='comic')),
 CONSTRAINT reading_works_page_count_check CHECK (page_count IS NULL OR page_count BETWEEN 1 AND 1000000),
 CONSTRAINT reading_works_metadata_bounds_check CHECK (length(title) BETWEEN 1 AND 500 AND cardinality(authors)<=50 AND cardinality(subjects)<=100)
);
--> statement-breakpoint
CREATE INDEX reading_works_kind_title_idx ON reading_works(kind,title,id);
--> statement-breakpoint
CREATE TABLE reading_progress (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 work_id uuid NOT NULL REFERENCES reading_works(id) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'planned',
 page integer NOT NULL DEFAULT 0,
 total_pages integer,
 started_at timestamptz,
 completed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,work_id),
 CONSTRAINT reading_progress_state_check CHECK (state IN ('planned','reading','completed','paused','dropped')),
 CONSTRAINT reading_progress_pages_check CHECK (page BETWEEN 0 AND 1000000 AND (total_pages IS NULL OR (total_pages BETWEEN 1 AND 1000000 AND page<=total_pages))),
 CONSTRAINT reading_progress_completion_check CHECK ((state='completed')=(completed_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX reading_progress_user_state_idx ON reading_progress(user_id,state,updated_at,work_id);
--> statement-breakpoint
CREATE TRIGGER reading_works_content_insert AFTER INSERT ON reading_works REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER reading_works_content_update AFTER UPDATE ON reading_works REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER reading_works_content_delete AFTER DELETE ON reading_works REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select ''global''::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER reading_progress_content_insert AFTER INSERT ON reading_progress REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER reading_progress_content_update AFTER UPDATE ON reading_progress REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
--> statement-breakpoint
CREATE TRIGGER reading_progress_content_delete AFTER DELETE ON reading_progress REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION coast_content_revision_trigger('tracking,social','select user_id::text as scope from changed');
