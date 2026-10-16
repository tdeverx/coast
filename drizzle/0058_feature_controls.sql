-- Commands hold shared policy/subject locks until commit. Settings updates acquire the
-- corresponding exclusive lock, so withdrawal is ordered against admitted writes.
-- Read projections keep using the non-locking predicates below.
CREATE FUNCTION coast_lock_feature_policy(subject_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('coast:configuration',0));
 PERFORM id FROM users WHERE id=subject_id FOR SHARE;
END
$$;
--> statement-breakpoint
-- Policy is evaluated against the actual subject, including workers and cross-user reads.
CREATE FUNCTION coast_feature_enabled(subject_id uuid, feature text) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH policy AS (
   SELECT coalesce((SELECT value FROM system_settings WHERE key='coast'),'{}'::jsonb) AS c,
     coalesce((SELECT settings FROM users WHERE id=subject_id),'{}'::jsonb) AS u
 ), admitted AS (
   SELECT *, coalesce(c->'features'->>'social','true')='true' AND coalesce(u->'features'->>'social','true')='true' AS social,
     coalesce(c->'features'->>'playback','true')='true' AND coalesce(u->'features'->>'playback','true')='true' AS playback FROM policy
 ) SELECT (subject_id IS NULL OR EXISTS(SELECT 1 FROM users WHERE id=subject_id AND NOT disabled))
 AND CASE
 WHEN feature IN ('screen','personalisation','social','presence','playback','reader','api') THEN coalesce(c->'features'->>feature,'true')='true'
 WHEN feature IN ('music','game','book','comic','parties','planning','mediaModal') THEN coalesce(c->>CASE feature WHEN 'music' THEN 'experimentalMusic' WHEN 'game' THEN 'experimentalGaming' WHEN 'book' THEN 'experimentalBooks' WHEN 'comic' THEN 'experimentalComics' WHEN 'parties' THEN 'experimentalParties' WHEN 'planning' THEN 'experimentalPlanning' ELSE 'experimentalMediaModal' END,'false')='true'
 WHEN feature='requests' THEN coalesce(c->>'enableRequests','true')='true'
 WHEN feature='sharing' THEN coalesce(c->>'allowPlaybackSharing','false')='true'
 ELSE false END
 AND (feature='api' OR coalesce(u->'features'->>feature,'true')='true')
 AND (feature NOT IN ('presence','parties') OR social)
 AND (feature<>'sharing' OR playback) FROM admitted
$$;
--> statement-breakpoint
CREATE FUNCTION coast_category_enabled(subject_id uuid, category text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN category='reading' THEN coast_feature_enabled(subject_id,'book') OR coast_feature_enabled(subject_id,'comic')
 WHEN category IN ('screen','music','game','book','comic') THEN coast_feature_enabled(subject_id,category) ELSE false END
$$;
--> statement-breakpoint
CREATE FUNCTION coast_job_allowed(subject_id uuid, job_kind text, payload jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT CASE
 WHEN job_kind IN ('jellyfin.streams','jellyfin.updates','feature.reconcile','benchmark.run') THEN true
 WHEN job_kind IN ('tmdb.recommendations','igdb.recommendations','taste.refresh') THEN coast_feature_enabled(NULL,'personalisation') AND (job_kind<>'igdb.recommendations' OR coast_feature_enabled(NULL,'game')) AND (job_kind<>'tmdb.recommendations' OR coast_feature_enabled(NULL,'screen'))
 WHEN job_kind='trakt.recommendations' THEN coast_feature_enabled(subject_id,'personalisation') AND coast_feature_enabled(subject_id,'screen')
 WHEN job_kind='catalogue.user-scan' THEN coast_feature_enabled(subject_id,'screen')
 WHEN job_kind='tmdb.refresh' THEN coast_feature_enabled(NULL,'screen')
 WHEN job_kind='igdb.steam-metadata' THEN coast_feature_enabled(NULL,'game')
 WHEN job_kind IN ('steam.sync','steam.achievements') THEN coast_feature_enabled(subject_id,'game')
 WHEN job_kind='jellyfin.library' OR job_kind='jellyfin.delta' AND payload->>'scope'='library' THEN coast_feature_enabled(NULL,'screen') OR coast_feature_enabled(NULL,'music') OR coast_feature_enabled(NULL,'book') OR coast_feature_enabled(NULL,'comic')
 WHEN job_kind IN ('jellyfin.sync','jellyfin.delta') THEN coast_feature_enabled(subject_id,'screen') OR coast_feature_enabled(subject_id,'music') OR coast_feature_enabled(subject_id,'book') OR coast_feature_enabled(subject_id,'comic')
 WHEN job_kind='trakt.scrobble' THEN coast_feature_enabled(subject_id,'presence') AND coast_feature_enabled(subject_id,'screen')
 WHEN job_kind LIKE '%.live' THEN coast_feature_enabled(subject_id,'presence') AND (job_kind<>'steam.live' OR coast_feature_enabled(subject_id,'game')) AND (job_kind<>'trakt.live' OR coast_feature_enabled(subject_id,'screen'))
 WHEN job_kind='trakt.checkin' AND EXISTS(SELECT 1 FROM social_checkins WHERE user_id=subject_id AND id::text=payload->>'checkinId' AND state<>'active') THEN true
 WHEN job_kind IN ('trakt.checkin','social.checkin-complete') THEN coast_feature_enabled(subject_id,'presence') AND coast_feature_enabled(subject_id,'screen')
 WHEN job_kind='planning.reminder' THEN coast_feature_enabled(subject_id,'planning')
 WHEN job_kind='webhook.deliver' THEN coast_feature_enabled(subject_id,'api')
 WHEN job_kind='seerr.request' THEN coast_feature_enabled(subject_id,'requests') AND coast_feature_enabled(subject_id,'screen')
 WHEN job_kind='seerr.sync' THEN coast_feature_enabled(subject_id,'requests')
 WHEN job_kind LIKE 'trakt.%' AND job_kind NOT IN ('trakt.scrobble','trakt.list-delete','trakt.collection-cleanup') THEN coast_feature_enabled(subject_id,'screen')
 ELSE true END
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION social_notification_visible(viewer_id uuid,kind_name text,payload jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT (CASE WHEN kind_name IN ('friend-request','friend-accepted','recommendation','reaction') THEN coast_feature_enabled(viewer_id,'social')
 WHEN kind_name='synced-invite' THEN coast_feature_enabled(viewer_id,'parties')
 WHEN kind_name='planning' THEN coast_feature_enabled(viewer_id,'planning')
 WHEN kind_name='request' THEN coast_feature_enabled(viewer_id,'requests') ELSE true END)
 AND (payload->>'actorId' IS NULL OR kind_name NOT IN ('friend-request','friend-accepted','recommendation','reaction','synced-invite') OR coast_feature_enabled((payload->>'actorId')::uuid,'social'))
 AND (payload->>'workId' IS NULL OR EXISTS(SELECT 1 FROM works WHERE id=(payload->>'workId')::uuid AND coast_category_enabled(viewer_id,category)))
 AND CASE WHEN kind_name NOT IN ('friend-request','friend-accepted','recommendation','reaction','synced-invite','planning') THEN true WHEN payload IS NULL THEN true
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

--> statement-breakpoint
CREATE FUNCTION coast_notification_visible(viewer_id uuid, kind_name text, payload jsonb, source text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT social_notification_visible(viewer_id,kind_name,payload) AND NOT EXISTS(
   SELECT 1 FROM works w WHERE w.id IN (
     SELECT media_id FROM synced_rooms WHERE kind_name='synced-invite' AND id::text=payload->>'subjectId'
     UNION ALL SELECT work_id FROM social_recommendations WHERE kind_name='recommendation' AND id::text=payload->>'subjectId'
     UNION ALL SELECT work_id FROM social_activity WHERE kind_name='reaction' AND id::text=payload->>'subjectId'
     UNION ALL SELECT media_id FROM media_requests WHERE kind_name='request' AND (id::text=payload->>'subjectId' OR source LIKE 'seerr:'||instance_id||':'||external_id||':%') AND user_id=viewer_id
     UNION ALL SELECT substring(source from 11)::uuid WHERE kind_name='availability' AND source~'^available:[0-9a-fA-F-]{36}$'
   ) AND NOT coast_category_enabled(viewer_id,w.category))
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION social_visible(owner_id uuid, viewer_id uuid, section_name text, category_name text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT (category_name IS NULL OR coast_category_enabled(owner_id,category_name) AND coast_category_enabled(viewer_id,category_name))
 AND (section_name NOT IN ('presence','reactions') OR coast_feature_enabled(owner_id,CASE WHEN section_name='presence' THEN 'presence' ELSE 'social' END) AND coast_feature_enabled(viewer_id,CASE WHEN section_name='presence' THEN 'presence' ELSE 'social' END))
 AND EXISTS(SELECT 1 FROM users u WHERE u.id=owner_id AND NOT u.disabled AND
 (u.id=viewer_id OR (COALESCE(u.settings->'social'->>'audience','friends')<>'private' AND
 CASE COALESCE(u.settings->'social'->'sections'->>section_name,u.settings->'social'->>'audience','friends')
 WHEN 'public' THEN true WHEN 'private' THEN false ELSE EXISTS(SELECT 1 FROM friendships f WHERE f.state='accepted' AND f.user_a=LEAST(owner_id,viewer_id) AND f.user_b=GREATEST(owner_id,viewer_id)) END AND
 CASE COALESCE(u.settings->'social'->'categories'->>category_name,'public')
 WHEN 'public' THEN true WHEN 'private' THEN false ELSE EXISTS(SELECT 1 FROM friendships f WHERE f.state='accepted' AND f.user_a=LEAST(owner_id,viewer_id) AND f.user_b=GREATEST(owner_id,viewer_id)) END)))
$$;
