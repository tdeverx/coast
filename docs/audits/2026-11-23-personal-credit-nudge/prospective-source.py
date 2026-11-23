"""Read the TMDB snapshots Coast knows now and currently rated roots for a private research cohort."""
import argparse
import json
import os
from pathlib import Path
import subprocess
from uuid import UUID


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('container', help='Apple container running Coast')
    ap.add_argument('username')
    ap.add_argument('capture', type=Path)
    ap.add_argument('destination', type=Path)
    args = ap.parse_args()
    data = json.loads(args.capture.read_bytes())
    ids = {str(UUID(r['work']['id'])) for d in data for r in d['history']}
    ids.update(str(UUID(r['id'])) for d in data for r in d['catalogue'])
    # UUID validation above makes each element safe to send as a typed SQL constant.
    # psql quotes the username using its own literal-quoting facility.
    roots = ','.join("'" + i + "'" for i in sorted(ids))
    sql = """
    BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
    SET LOCAL statement_timeout = '20s';
    SET LOCAL TIME ZONE 'UTC';
    WITH viewer AS (
      SELECT id FROM users WHERE lower(username) = lower(:'username') AND NOT disabled
    ), requested AS (
      SELECT unnest(ARRAY[ROOTS]::uuid[]) AS id
    ), catalogue AS (
      SELECT m.id FROM requested JOIN media m USING (id) WHERE m.kind IN ('movie','show')
    ), source AS (
      SELECT DISTINCT ON (x.media_id) x.media_id AS id, x.updated_at, x.raw#>'{facts,audience}' AS audience
      FROM catalogue c JOIN metadata_snapshots x ON x.media_id = c.id
      WHERE x.provider = 'tmdb' AND x.raw#>'{facts,audience}' IS NOT NULL
      ORDER BY x.media_id, x.updated_at DESC, x.id
    ), links AS (
      SELECT c.id, json_agg(DISTINCT r.parent_id ORDER BY r.parent_id) AS parents
      FROM catalogue c JOIN media_relationships r ON r.child_id=c.id
      WHERE r.kind IN ('collection','franchise') GROUP BY c.id
    )
    SELECT json_build_object(
      'accountKey', encode(sha256(convert_to('coast-prospective-audience:' || v.id::text,'UTF8')),'hex'),
      'source', 'coast.metadata_snapshots/tmdb', 'readAt', transaction_timestamp(),
      'rows', (SELECT coalesce(json_agg(json_build_object('id',id,'score',audience->'score',
                    'votes',audience->'votes','observedAt',updated_at) ORDER BY id),'[]')
               FROM source WHERE audience->'scale'='10'::jsonb
                 AND jsonb_typeof(audience->'score')='number' AND (audience->>'score')::numeric > 0
                 AND (audience->>'score')::numeric <= 10
                 AND jsonb_typeof(audience->'votes')='number' AND (audience->>'votes')::numeric > 0),
      'collections', (SELECT coalesce(json_object_agg(id,parents),'{}') FROM links),
      'catalogueIds', (SELECT json_agg(id ORDER BY id) FROM catalogue),
      'alreadyRated', (SELECT coalesce(json_agg(r.media_id ORDER BY r.media_id),'[]')
                      FROM ratings r JOIN catalogue c ON r.media_id=c.id WHERE r.user_id=v.id)
    ) FROM viewer v;
    COMMIT;
    """.replace('ROOTS', roots)
    command = ['container', 'exec', '-i', args.container, '/usr/lib/postgresql/17/bin/psql',
               '-XqAt', '-h', '/var/run/postgresql', '-U', 'coast', '-d', 'coast',
               '-v', 'ON_ERROR_STOP=1', '-v', 'username=' + args.username]
    result = subprocess.run(command, input=sql, text=True, stdout=subprocess.PIPE, check=True)
    if not result.stdout.strip():
        raise SystemExit('No active matching Coast account. No snapshot written.')
    snapshot = json.loads(result.stdout)
    if not snapshot['catalogueIds']:
        raise SystemExit('No captured IDs matched this catalogue. No snapshot written.')
    with os.fdopen(os.open(args.destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), 'w') as f:
        json.dump(snapshot, f, separators=(',', ':'), allow_nan=False)
    print(json.dumps(dict(asOf=snapshot['readAt'], inCatalogue=len(snapshot['catalogueIds']),
                          withTmdb=len(snapshot['rows']), alreadyRated=len(snapshot['alreadyRated']))))


if __name__ == '__main__':
    main()
