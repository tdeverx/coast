UPDATE system_settings SET value = (value - 'experimentalFeatures') || jsonb_build_object(
  'experimentalMusic', coalesce(value->'experimentalMusic', value->'experimentalFeatures', 'false'::jsonb),
  'experimentalGaming', coalesce(value->'experimentalGaming', value->'experimentalFeatures', 'false'::jsonb),
  'experimentalParties', coalesce(value->'experimentalParties', value->'experimentalFeatures', 'false'::jsonb)
) WHERE key = 'coast';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION social_notification_visible(viewer_id uuid,kind_name text,payload jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN payload IS NULL THEN true
 WHEN kind_name='synced-invite' THEN EXISTS(
   SELECT 1 FROM synced_rooms r JOIN synced_participants p ON p.room_id=r.id
   JOIN friendships f ON f.user_a=least(r.host_id,viewer_id) AND f.user_b=greatest(r.host_id,viewer_id)
   JOIN users u ON u.id=r.host_id WHERE r.id=(payload->>'subjectId')::uuid AND p.user_id=viewer_id
   AND r.ended_at IS NULL AND r.created_at>NOW()-INTERVAL '24 hours' AND f.state='accepted' AND NOT u.disabled
   AND coalesce((SELECT (value->>'experimentalParties')::boolean FROM system_settings WHERE key='coast'),false))
 WHEN kind_name='friend-request' THEN EXISTS(SELECT 1 FROM friendships f JOIN users u ON u.id=f.requested_by WHERE f.id=(payload->>'subjectId')::uuid AND f.state='pending' AND f.requested_by<>viewer_id AND (f.user_a=viewer_id OR f.user_b=viewer_id) AND NOT u.disabled)
 WHEN kind_name='recommendation' THEN EXISTS(SELECT 1 FROM social_recommendations r JOIN friendships f ON f.user_a=least(r.sender_id,r.recipient_id) AND f.user_b=greatest(r.sender_id,r.recipient_id) JOIN users u ON u.id=r.sender_id WHERE r.id=(payload->>'subjectId')::uuid AND r.recipient_id=viewer_id AND r.state='pending' AND f.state='accepted' AND NOT u.disabled)
 WHEN kind_name='reaction' THEN EXISTS(SELECT 1 FROM social_activity a JOIN works w ON w.id=a.work_id JOIN social_reactions r ON r.target_kind='activity' AND r.target_id=a.id AND r.user_id=(payload->>'actorId')::uuid WHERE a.id=(payload->>'subjectId')::uuid AND social_visible(a.user_id,viewer_id,a.section,w.category) AND social_visible(r.user_id,viewer_id,'reactions',w.category))
 ELSE social_visible((payload->>'actorId')::uuid,viewer_id,'details') END
$$;
