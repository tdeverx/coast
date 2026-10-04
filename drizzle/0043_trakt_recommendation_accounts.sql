-- Account recommendation caches are rebuilt by the existing refresh job.
-- Retire the old shared keys so removed suggestions cannot survive a refresh.
DELETE FROM recommendation_sets
WHERE connection_id IS NOT NULL
  AND key IN ('account:movie', 'account:show')
  AND instance_id IN (SELECT id FROM provider_instances WHERE provider = 'trakt');
