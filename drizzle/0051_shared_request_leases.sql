CREATE TABLE share_request_leases (
  id uuid PRIMARY KEY,
  viewer_id uuid NOT NULL REFERENCES share_viewers(id) ON DELETE CASCADE,
  playback_id uuid NOT NULL REFERENCES playback_sessions(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX share_request_leases_viewer_idx ON share_request_leases(viewer_id,expires_at);
CREATE INDEX share_request_leases_playback_idx ON share_request_leases(playback_id,expires_at);
