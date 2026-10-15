ALTER TABLE playback_sessions ADD COLUMN account_generation uuid;
--> statement-breakpoint
-- Personal sessions created before generation pinning cannot prove their account.
UPDATE playback_sessions SET state='stopped',updated_at=now() WHERE share_id IS NULL;
--> statement-breakpoint
UPDATE playback_sessions p SET account_generation=s.account_generation
FROM playback_shares s WHERE p.share_id=s.id;
