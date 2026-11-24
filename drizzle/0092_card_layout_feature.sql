CREATE OR REPLACE FUNCTION coast_feature_enabled(subject_id uuid, feature text) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH policy AS (
   SELECT coalesce((SELECT value FROM system_settings WHERE key='coast'),'{}'::jsonb) AS c,
     coalesce(subject.settings,'{}'::jsonb) AS u, coalesce(subject.access_defaults,'{}'::jsonb) AS a,
     subject.id is not null and not subject.disabled and coalesce(subject.membership_expires_at>now(),true) as active
   FROM (SELECT subject_id AS id) requested LEFT JOIN users subject ON subject.id=requested.id
 ), admitted AS (
   SELECT *, coalesce(c->'features'->>'social','true')='true' AND coalesce(u->'features'->>'social','true')='true' AND coalesce(a->>'social','true')='true' AS social,
     coalesce(c->'features'->>'playback','true')='true' AND coalesce(u->'features'->>'playback','true')='true' AS playback FROM policy
 ) SELECT (subject_id IS NULL OR active)
 AND coalesce(a->>feature,'true')<>'false'
 AND NOT(coalesce(a->>'libraryOnly','false')='true' AND feature IN ('sharing','requests','api','personalisation','parties','planning','mediaModal','game'))
 AND CASE
 WHEN feature='cardLayouts' THEN coalesce(c->'features'->>'cardLayouts','false')='true'
 WHEN feature IN ('screen','personalisation','social','presence','playback','reader','api') THEN coalesce(c->'features'->>feature,'true')='true'
 WHEN feature IN ('music','game','book','comic','parties','planning','mediaModal') THEN coalesce(c->>CASE feature WHEN 'music' THEN 'experimentalMusic' WHEN 'game' THEN 'experimentalGaming' WHEN 'book' THEN 'experimentalBooks' WHEN 'comic' THEN 'experimentalComics' WHEN 'parties' THEN 'experimentalParties' WHEN 'planning' THEN 'experimentalPlanning' ELSE 'experimentalMediaModal' END,'false')='true'
 WHEN feature='requests' THEN coalesce(c->>'enableRequests','true')='true'
 WHEN feature='sharing' THEN coalesce(c->>'allowPlaybackSharing','false')='true'
 ELSE false END
 AND (feature='api' OR coalesce(u->'features'->>feature,'true')='true')
 AND (feature NOT IN ('presence','parties') OR social)
 AND (feature<>'sharing' OR playback) FROM admitted
$$;
