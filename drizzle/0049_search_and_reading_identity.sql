-- Native full-text indexes keep broad/typo candidate retrieval out of application memory.
CREATE FUNCTION coast_search_document(title text, extra text DEFAULT NULL, labels text[] DEFAULT '{}')
RETURNS tsvector LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT to_tsvector('simple',regexp_replace(lower(normalize(coalesce(title,'') || ' ' || coalesce(extra,'') || ' ' || array_to_string(coalesce(labels,'{}'),' '),NFKC)), '[^[:alnum:]]+', ' ', 'g'));
$$;
--> statement-breakpoint
CREATE FUNCTION coast_search_text(value text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT trim(regexp_replace(lower(normalize(coalesce(value,''),NFKC)), '[^[:alnum:]]+', ' ', 'g'));
$$;
--> statement-breakpoint
CREATE INDEX media_search_document_idx ON media USING gin(coast_search_document(title,original_title));
--> statement-breakpoint
CREATE INDEX metadata_snapshots_search_document_idx ON metadata_snapshots USING gin(coast_search_document(title,original_title));
--> statement-breakpoint
CREATE INDEX metadata_overrides_search_document_idx ON metadata_overrides USING gin(coast_search_document(title,original_title));
--> statement-breakpoint
CREATE INDEX user_metadata_preferences_search_document_idx ON user_metadata_preferences USING gin(coast_search_document(title));
--> statement-breakpoint
CREATE INDEX games_search_document_idx ON games USING gin(coast_search_document(title));
--> statement-breakpoint
CREATE INDEX reading_works_search_document_idx ON reading_works USING gin(coast_search_document(title,series_title,authors));
--> statement-breakpoint
ALTER TABLE reading_works DROP CONSTRAINT reading_works_provider_kind_check;
--> statement-breakpoint
ALTER TABLE reading_works ADD CONSTRAINT reading_works_provider_kind_check CHECK
 ((provider='openlibrary' AND kind IN ('book','comic')) OR (provider='comic-vine' AND kind='comic'));
