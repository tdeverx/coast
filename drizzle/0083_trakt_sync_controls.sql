-- Grouped shows did not have a stable page boundary. Retain committed movie
-- observations and restart only the episode census before inferring absences.
DELETE FROM trakt_import_records r USING trakt_import_stages s
WHERE r.stage_id = s.id AND s.category = 'collection' AND s.next_page < 0
  AND s.phase <> 'done' AND r.record->>'type' = 'coast-collection-episode';
--> statement-breakpoint
UPDATE trakt_import_stages SET phase = 'fetching', next_page = -1,
  cleaned_through = NULL, updated_at = now()
WHERE category = 'collection' AND next_page < 0 AND phase <> 'done';
--> statement-breakpoint
UPDATE outbox_actions
SET payload = jsonb_set(payload, '{_checkpoint,cursor,page}', '1', false)
WHERE kind = 'catalogue.user-scan' AND state IN ('pending', 'running', 'failed')
  AND payload->'_checkpoint' @> '{"task":"user-catalogue","provider":"trakt","cursor":{"stage":5}}'
  AND payload#>>'{_checkpoint,cursor,page}' <> '1';
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
      AND c.settings->'traktAccess' @> '{"export":true}'::jsonb
      AND jsonb_typeof(c.settings->'traktAccess'->'import') = 'boolean'
    ORDER BY c.id FOR SHARE OF c;
  END IF;
  RETURN NEW;
END $$;
