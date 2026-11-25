-- Carry forward experiments that were already offered to existing accounts.
WITH policy AS (
  SELECT coalesce((SELECT value FROM system_settings WHERE key = 'coast'), '{}'::jsonb) AS config
), grants AS (
  SELECT coalesce(jsonb_object_agg(feature, true) FILTER (WHERE enabled), '{}'::jsonb) AS permissions
  FROM policy, LATERAL (VALUES
    ('music', config->>'experimentalMusic' = 'true'),
    ('game', config->>'experimentalGaming' = 'true'),
    ('book', config->>'experimentalBooks' = 'true'),
    ('comic', config->>'experimentalComics' = 'true'),
    ('parties', config->>'experimentalParties' = 'true'),
    ('planning', config->>'experimentalPlanning' = 'true'),
    ('richToasts', config->>'experimentalRichToasts' = 'true'),
    ('cardTasteScores', config->>'experimentalCardTasteScores' = 'true'),
    ('cardLayouts', config#>>'{features,cardLayouts}' = 'true')
  ) AS feature_policy(feature, enabled)
)
UPDATE users u
SET settings = jsonb_set(u.settings, '{featurePermissions}', grants.permissions || coalesce(u.settings->'featurePermissions', '{}'::jsonb))
FROM grants WHERE grants.permissions <> '{}'::jsonb;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION coast_feature_enabled(subject_id uuid, feature text) RETURNS boolean LANGUAGE sql STABLE AS $$
  WITH policy AS (
    SELECT coalesce((SELECT value FROM system_settings WHERE key='coast'),'{}'::jsonb) AS c,
      coalesce(u.settings,'{}'::jsonb) AS s, coalesce(u.access_defaults,'{}'::jsonb) AS a, u.role,
      u.id is not null and not u.disabled and coalesce(u.membership_expires_at>now(),true) AS active
    FROM (SELECT subject_id AS id) requested LEFT JOIN users u ON u.id=requested.id
  ), admitted AS (
    SELECT *,
      coalesce(s#>>'{featurePermissions,social}',c#>>'{features,social}','true')='true'
        AND coalesce(s#>>'{features,social}','true')='true' AND coalesce(a->>'social','true')='true' AS social,
      coalesce(s#>>'{featurePermissions,playback}',c#>>'{features,playback}','true')='true'
        AND coalesce(s#>>'{features,playback}','true')='true' AND coalesce(a->>'playback','true')='true' AS playback,
      coalesce(s#>>'{featurePermissions,personalisation}',c#>>'{features,personalisation}','true')='true'
        AND coalesce(s#>>'{features,personalisation}','true')='true' AND coalesce(a->>'personalisation','true')='true' AS personalisation
    FROM policy
  )
  SELECT (subject_id IS NULL OR active)
    AND coalesce(a->>feature,'true')<>'false'
    AND NOT(coalesce(a->>'libraryOnly','false')='true' AND feature IN ('sharing','requests','api','personalisation','parties','planning','mediaModal','game','cardTasteScores','richToasts'))
    AND coalesce((s->'featurePermissions'->>feature)::boolean, CASE
      WHEN feature IN ('screen','personalisation','social','presence','playback','reader','api') THEN coalesce(c->'features'->>feature,'true')='true'
      WHEN feature='settingsSidebar' THEN false
      WHEN feature='cardLayouts' THEN coalesce(c->'features'->>'cardLayouts','false')='true'
      WHEN feature IN ('music','game','book','comic','parties','planning','mediaModal','richToasts','cardTasteScores') THEN
        coalesce(c->>CASE feature WHEN 'music' THEN 'experimentalMusic' WHEN 'game' THEN 'experimentalGaming'
          WHEN 'book' THEN 'experimentalBooks' WHEN 'comic' THEN 'experimentalComics' WHEN 'parties' THEN 'experimentalParties' WHEN 'planning' THEN 'experimentalPlanning'
          WHEN 'richToasts' THEN 'experimentalRichToasts' WHEN 'cardTasteScores' THEN 'experimentalCardTasteScores' ELSE 'experimentalMediaModal' END,'false')='true'
      WHEN feature='requests' THEN coalesce(c->>'enableRequests','true')='true'
      WHEN feature='sharing' THEN coalesce(c->>'allowPlaybackSharing','false')='true'
        AND (subject_id IS NULL OR role='admin' OR coalesce(s->>'allowPlaybackSharing','false')='true')
      ELSE false END)
    AND coalesce(s->'features'->>feature,'true')='true'
    AND (feature NOT IN ('presence','parties') OR social)
    AND (feature<>'sharing' OR playback)
    AND (feature<>'cardTasteScores' OR personalisation)
  FROM admitted
$$;
--> statement-breakpoint
CREATE FUNCTION coast_shared_feature_enabled(feature text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE NOT disabled
    AND coalesce(membership_expires_at>now(),true) AND coast_feature_enabled(id,feature))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION coast_job_allowed(subject_id uuid, job_kind text, payload jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT CASE
 WHEN job_kind IN ('jellyfin.streams','jellyfin.updates','feature.reconcile','benchmark.run') THEN true
 WHEN job_kind IN ('tmdb.recommendations','igdb.recommendations','taste.refresh') THEN coast_shared_feature_enabled('personalisation') AND (job_kind<>'igdb.recommendations' OR coast_shared_feature_enabled('game')) AND (job_kind<>'tmdb.recommendations' OR coast_shared_feature_enabled('screen'))
 WHEN job_kind='trakt.recommendations' THEN coast_feature_enabled(subject_id,'personalisation') AND coast_feature_enabled(subject_id,'screen')
 WHEN job_kind='catalogue.user-scan' THEN coast_feature_enabled(subject_id,'screen')
 WHEN job_kind='tmdb.refresh' THEN coast_shared_feature_enabled('screen')
 WHEN job_kind='igdb.steam-metadata' THEN coast_shared_feature_enabled('game')
 WHEN job_kind IN ('steam.sync','steam.achievements') THEN coast_feature_enabled(subject_id,'game')
 WHEN job_kind='jellyfin.library' OR job_kind='jellyfin.delta' AND payload->>'scope'='library' THEN coast_shared_feature_enabled('screen') OR coast_shared_feature_enabled('music') OR coast_shared_feature_enabled('book') OR coast_shared_feature_enabled('comic')
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
   AND coast_feature_enabled(r.host_id,'parties'))
 WHEN kind_name='friend-request' THEN EXISTS(SELECT 1 FROM friendships f JOIN users u ON u.id=f.requested_by WHERE f.id=(payload->>'subjectId')::uuid AND f.state='pending' AND f.requested_by<>viewer_id AND (f.user_a=viewer_id OR f.user_b=viewer_id) AND NOT u.disabled)
 WHEN kind_name='recommendation' THEN EXISTS(SELECT 1 FROM social_recommendations r JOIN friendships f ON f.user_a=least(r.sender_id,r.recipient_id) AND f.user_b=greatest(r.sender_id,r.recipient_id) JOIN users u ON u.id=r.sender_id WHERE r.id=(payload->>'subjectId')::uuid AND r.recipient_id=viewer_id AND r.state='pending' AND f.state='accepted' AND NOT u.disabled)
 WHEN kind_name='reaction' THEN EXISTS(SELECT 1 FROM social_activity a JOIN works w ON w.id=a.work_id JOIN social_reactions r ON r.target_kind='activity' AND r.target_id=a.id AND r.user_id=(payload->>'actorId')::uuid WHERE a.id=(payload->>'subjectId')::uuid AND social_visible(a.user_id,viewer_id,a.section,w.category) AND social_visible(r.user_id,viewer_id,'reactions',w.category))
 ELSE social_visible((payload->>'actorId')::uuid,viewer_id,'details') END
$$;
