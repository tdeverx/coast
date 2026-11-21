-- Existing links keep their prior account grant until per-feature choices are saved.
CREATE FUNCTION coast_trakt_sync_allowed(settings jsonb, direction text, feature text DEFAULT NULL)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(CASE
    WHEN NOT (settings ? 'traktSync') THEN
      CASE WHEN NOT (settings ? 'traktAccess') THEN direction = 'import'
        ELSE jsonb_typeof(settings->'traktAccess'->'import') = 'boolean'
          AND jsonb_typeof(settings->'traktAccess'->'export') = 'boolean'
          AND settings->'traktAccess'->direction = 'true'::jsonb
      END
    WHEN feature IS NULL THEN
      CASE WHEN direction = 'import' THEN settings->'traktSync'->direction @>
        ANY (ARRAY['{"history":true}', '{"progress":true}', '{"collection":true}', '{"ratings":true}', '{"watchlist":true}', '{"lists":true}', '{"live":true}', '{"recommendations":true}']::jsonb[])
      WHEN direction = 'export' THEN settings->'traktSync'->direction @>
        ANY (ARRAY['{"history":true}', '{"progress":true}', '{"collection":true}', '{"ratings":true}', '{"watchlist":true}', '{"lists":true}', '{"scrobble":true}']::jsonb[]) END
    WHEN feature = 'tracking' AND direction = 'import' THEN settings->'traktSync'->direction @>
      ANY (ARRAY['{"history":true}', '{"progress":true}', '{"collection":true}', '{"ratings":true}', '{"watchlist":true}']::jsonb[])
    ELSE settings->'traktSync'->direction->feature = 'true'::jsonb
  END, false)
$$;
--> statement-breakpoint
-- All timed check-in cancellation paths share this trigger, including feature withdrawal.
CREATE OR REPLACE FUNCTION social_queue_checkin_cancel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'active' AND NEW.state = 'cancelled' AND NEW.mode = 'timed' THEN
    INSERT INTO outbox_actions (user_id, connection_id, account_generation, kind, payload, compaction_key)
    SELECT NEW.user_id, c.id, c.account_generation, 'trakt.checkin',
      jsonb_build_object('checkinId', NEW.id, '_jobPurpose', 'playback'), 'checkin-cancel:' || NEW.id
    FROM social_live_deliveries d
    JOIN provider_connections c ON c.id = d.connection_id AND c.account_generation = d.account_generation
    JOIN provider_instances i ON i.id = c.instance_id AND i.provider = 'trakt' AND i.enabled
    WHERE d.checkin_id = NEW.id AND d.state IN ('started', 'uncertain')
      AND c.user_id = NEW.user_id AND c.status = 'connected'
      AND coast_trakt_sync_allowed(c.settings, 'export', 'scrobble')
    ORDER BY c.id FOR SHARE OF c;
  END IF;
  RETURN NEW;
END $$;
