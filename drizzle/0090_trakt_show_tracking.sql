-- New show-tracking permissions require an explicit granular grant.
CREATE OR REPLACE FUNCTION coast_trakt_sync_allowed(settings jsonb, direction text, feature text DEFAULT NULL)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(CASE
    WHEN feature IN ('trackingStatus', 'rewatch') THEN settings->'traktSync'->direction->feature = 'true'::jsonb
    WHEN NOT (settings ? 'traktSync') THEN
      CASE WHEN NOT (settings ? 'traktAccess') THEN direction = 'import'
        ELSE jsonb_typeof(settings->'traktAccess'->'import') = 'boolean'
          AND jsonb_typeof(settings->'traktAccess'->'export') = 'boolean'
          AND settings->'traktAccess'->direction = 'true'::jsonb
      END
    WHEN feature IS NULL THEN
      CASE WHEN direction = 'import' THEN settings->'traktSync'->direction @>
        ANY (ARRAY['{"trackingStatus":true}', '{"rewatch":true}', '{"history":true}', '{"progress":true}', '{"collection":true}', '{"ratings":true}', '{"watchlist":true}', '{"lists":true}', '{"live":true}', '{"recommendations":true}']::jsonb[])
      WHEN direction = 'export' THEN settings->'traktSync'->direction @>
        ANY (ARRAY['{"trackingStatus":true}', '{"rewatch":true}', '{"history":true}', '{"progress":true}', '{"collection":true}', '{"ratings":true}', '{"watchlist":true}', '{"lists":true}', '{"scrobble":true}']::jsonb[]) END
    WHEN feature = 'tracking' AND direction = 'import' THEN settings->'traktSync'->direction @>
      ANY (ARRAY['{"trackingStatus":true}', '{"rewatch":true}', '{"history":true}', '{"progress":true}', '{"collection":true}', '{"ratings":true}', '{"watchlist":true}']::jsonb[])
    ELSE settings->'traktSync'->direction->feature = 'true'::jsonb
  END, false)
$$;
