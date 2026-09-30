import * as v from 'valibot';
import { and, eq } from 'drizzle-orm';
import { getDb, getSql } from '../db';
import { providerInstances } from '../db/schema';
import { getConfig } from '../config';
import { checkLoginRate, hashToken, newSession, type SessionUser } from './index';
import { getInstance, instanceTransport } from '$lib/providers/instances.server';
import { JellyfinAdapter } from '$lib/providers/jellyfin/adapter.server';
import { encryptCredential } from '../security/credentials';
import { ProviderHttpError } from '../security/provider-fetch';
import { AppError } from '../security/errors';
import { enqueueAction } from '../queue';
import { logDiagnostic } from '../diagnostics';

export async function jellyfinSignInServices() {
  const instances = await getDb()
    .select({
      id: providerInstances.id,
      name: providerInstances.name,
      identity: providerInstances.serverIdentity,
      settings: providerInstances.settings,
    })
    .from(providerInstances)
    .where(and(eq(providerInstances.provider, 'jellyfin'), eq(providerInstances.enabled, true)));
  return instances
    .filter((instance) => instance.identity && instance.settings.approved === true)
    .map((instance) => ({ id: instance.id, name: instance.name }));
}

export async function loginJellyfin(input: unknown, clientKey: string) {
  checkLoginRate(`ip:${clientKey}`);
  const credentials = v.parse(
    v.object({
      instanceId: v.pipe(v.string(), v.uuid()),
      username: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(250)),
      password: v.pipe(v.string(), v.maxLength(4096)),
    }),
    input
  );
  checkLoginRate(`jellyfin:${credentials.instanceId}:${credentials.username.toLowerCase()}`);
  const instance = await getInstance(credentials.instanceId, 'jellyfin');
  if (!instance.serverIdentity || instance.settings.approved !== true)
    throw new AppError(403, 'An administrator must verify this Jellyfin service before sign-in.');
  const deviceId = `coast-login-${await hashToken(`${instance.id}:${credentials.username}`)}`;
  let account, policy;
  try {
    account = await new JellyfinAdapter(instanceTransport(instance), deviceId).authenticate(
      credentials.username,
      credentials.password,
      instance.serverIdentity
    );
    policy = await new JellyfinAdapter(
      instanceTransport(instance),
      deviceId,
      account.accessToken
    ).userPolicy(account.id);
  } catch (cause) {
    if (cause instanceof ProviderHttpError && [401, 403].includes(cause.status))
      throw new AppError(
        401,
        'The Jellyfin username or password is incorrect, or the account cannot sign in.'
      );
    throw cause;
  }
  if (policy.disabled) throw new AppError(403, 'This Jellyfin account is disabled.');
  const secret = await encryptCredential(JSON.stringify({ accessToken: account.accessToken }));
  const identitySuffix = (await hashToken(`${instance.id}:${account.id}`)).slice(0, 12);
  const result = await getSql().begin(async (sql) => {
    // Serialize identity binding with connection edits and the last-administrator guard.
    await sql`SELECT pg_advisory_xact_lock(73001602)`;
    const config = await getConfig(sql);
    const [verified] =
      await sql`SELECT id FROM provider_instances WHERE id = ${instance.id} AND enabled = TRUE AND server_identity = ${account.serverId} AND settings->>'approved' = 'true'`;
    if (!verified)
      throw new AppError(403, 'This Jellyfin service is no longer available for sign-in.');
    const [identity] =
      await sql`SELECT user_id FROM user_identities WHERE instance_id = ${instance.id} AND external_user_id = ${account.id}`;
    let row;
    if (identity) {
      [row] =
        await sql`SELECT u.*, c.status AS connection_status FROM users u JOIN provider_connections c ON c.user_id = u.id WHERE u.id = ${identity.user_id} AND c.instance_id = ${instance.id} AND c.external_user_id = ${account.id} FOR UPDATE OF u`;
      if (!row)
        throw new AppError(403, 'This Jellyfin account is no longer linked to its Coast account.');
    } else {
      const linked =
        await sql`SELECT u.*, c.status AS connection_status FROM users u JOIN provider_connections c ON c.user_id = u.id WHERE c.instance_id = ${instance.id} AND c.external_user_id = ${account.id} FOR UPDATE OF u`;
      if (linked.length > 1)
        throw new AppError(
          409,
          'This Jellyfin account is linked to multiple Coast accounts. An administrator must resolve the links.'
        );
      row = linked[0];
      if (!row) {
        if (!config.jellyfinAutoCreateUsers)
          throw new AppError(
            403,
            'Ask an administrator to create a Coast account, then link your Jellyfin account.'
          );
        let username = account.username
          .toLowerCase()
          .replace(/[^a-z0-9_.-]+/g, '-')
          .replace(/^[^a-z0-9]+/, '')
          .slice(0, 32);
        if (username.length < 3) username = 'jellyfin-user';
        const [taken] = await sql`SELECT id FROM users WHERE lower(username) = ${username}`;
        if (taken) username = `${username.slice(0, 19)}-${identitySuffix}`;
        [row] =
          await sql`INSERT INTO users (username, password_hash, role) VALUES (${username}, NULL, 'user') RETURNING *`;
      }
      await sql`INSERT INTO user_identities (instance_id, external_user_id, user_id) VALUES (${instance.id}, ${account.id}, ${row.id})`;
    }
    if (row.disabled) throw new AppError(403, 'This Coast account is disabled.');
    const needsScan = row.connection_status !== 'connected';
    const role = config.jellyfinSyncAdmins ? (policy.administrator ? 'admin' : 'user') : row.role;
    if (role !== row.role) {
      if (row.role === 'admin') {
        const [admins] =
          await sql`SELECT count(*)::int AS total FROM users WHERE role = 'admin' AND disabled = FALSE AND id <> ${row.id}`;
        if (!admins.total)
          throw new AppError(
            409,
            'Keep an active Coast administrator before removing this account’s administrator role.'
          );
      }
      [row] = await sql`UPDATE users SET role = ${role} WHERE id = ${row.id} RETURNING *`;
      await sql`DELETE FROM sessions WHERE user_id = ${row.id}`;
    }
    const [connection] =
      await sql`INSERT INTO provider_connections (user_id, instance_id, external_user_id, username, credentials, status) VALUES (${row.id}, ${instance.id}, ${account.id}, ${account.username}, ${secret}, 'connected') ON CONFLICT (user_id, instance_id) DO UPDATE SET external_user_id = EXCLUDED.external_user_id, username = EXCLUDED.username, credentials = EXCLUDED.credentials, status = 'connected', updated_at = NOW() RETURNING id`;
    return {
      user: {
        id: row.id,
        username: row.username,
        email: row.email,
        role: row.role,
        settings: row.settings || {},
      } as SessionUser,
      connectionId: connection.id,
      needsScan,
    };
  });
  if (result.needsScan)
    await enqueueAction({
      userId: result.user.id,
      connectionId: result.connectionId,
      kind: 'jellyfin.sync',
      payload: {},
      compactionKey: 'jellyfin.sync',
    }).catch(() => logDiagnostic('warn', 'job.failed', { failure: 'unexpected' }));
  return newSession(result.user);
}
