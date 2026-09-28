import { mkdir, open, readFile, chmod, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';

let keyPromise: Promise<CryptoKey> | undefined;
export function dataDirectory() {
  return process.env.COAST_DATA_DIR || '/data';
}

async function loadKey() {
  const directory = join(dataDirectory(), 'secrets');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'credentials.key');
  const candidate = `${path}.${crypto.randomUUID()}`;
  const handle = await open(candidate, 'wx', 0o600);
  try {
    await handle.writeFile(crypto.getRandomValues(new Uint8Array(32)));
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(candidate, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  } finally {
    await unlink(candidate);
  }
  await chmod(path, 0o600);
  const bytes = await readFile(path);
  if (bytes.length !== 32)
    throw new Error('The Coast credential key is invalid. Restore the original key from backup.');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export function initializeCredentialKey() {
  return (keyPromise ??= loadKey());
}

export async function encryptCredential(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('coast.credentials.v1') },
    await initializeCredentialKey(),
    new TextEncoder().encode(plain)
  );
  return `v1.${Buffer.from(iv).toString('base64url')}.${Buffer.from(encrypted).toString('base64url')}`;
}

export async function decryptCredential(cipher: string): Promise<string> {
  const [version, nonce, payload, extra] = cipher.split('.');
  if (version !== 'v1' || !nonce || !payload || extra)
    throw new Error('Invalid encrypted credential.');
  const iv = Buffer.from(nonce, 'base64url');
  if (iv.length !== 12) throw new Error('Invalid encrypted credential.');
  const result = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('coast.credentials.v1') },
    await initializeCredentialKey(),
    Buffer.from(payload, 'base64url')
  );
  return new TextDecoder().decode(result);
}
