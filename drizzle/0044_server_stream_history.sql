CREATE TABLE server_stream_scans (
 instance_id uuid PRIMARY KEY REFERENCES provider_instances(id) ON DELETE CASCADE,
 connection_id uuid REFERENCES provider_connections(id) ON DELETE SET NULL,
 account_generation uuid NOT NULL,
 checked_at timestamptz NOT NULL DEFAULT now(),
 last_error text
);
--> statement-breakpoint
CREATE TABLE server_stream_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 instance_id uuid NOT NULL REFERENCES provider_instances(id) ON DELETE CASCADE,
 session_id text NOT NULL,
 external_item_id text NOT NULL,
 snapshot jsonb NOT NULL,
 first_seen_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX server_stream_sessions_active_unique ON server_stream_sessions(instance_id, session_id) WHERE ended_at IS NULL;
--> statement-breakpoint
CREATE INDEX server_stream_sessions_history_idx ON server_stream_sessions(last_seen_at DESC, id DESC);
