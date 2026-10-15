DROP INDEX outbox_taste_one_active_idx;
--> statement-breakpoint
-- Retain one active refresh; terminal duplicates remain available in job history.
WITH ranked AS (
  SELECT id,row_number() OVER (ORDER BY (state='running') DESC,created_at,id) AS position
  FROM outbox_actions WHERE kind='taste.refresh' AND state IN ('pending','running','failed')
)
UPDATE outbox_actions a SET state='cancelled',locked_at=NULL,
  last_error='Duplicate taste refresh superseded during admission-index repair.',updated_at=now()
FROM ranked r WHERE a.id=r.id AND r.position>1;
--> statement-breakpoint
CREATE UNIQUE INDEX outbox_taste_one_active_idx ON outbox_actions(kind)
WHERE kind='taste.refresh' AND state IN ('pending','running','failed');
