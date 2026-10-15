import { expect, spyOn, test } from 'bun:test';
import { actions } from '../src/routes/setup/+page.server';
import { checkLoginRate } from '../src/lib/server/auth';

const valid = {
  username: 'setup-fixture', displayName: 'Setup Fixture',
  password: 'Setup-fixture-password!', passwordConfirmation: 'Setup-fixture-password!',
};
function event(setup: boolean, address: string) {
  return {
    request: new Request('https://coast.test/setup', { method: 'POST', body: new URLSearchParams(valid) }),
    url: new URL('https://coast.test/setup'), locals: { setup },
    cookies: { set() { throw new Error('Unexpected cookie before session creation.'); } },
    getClientAddress: () => address,
  } as unknown as Parameters<typeof actions.default>[0];
}

test('completed setup rejects repeated valid POSTs before parsing or hashing', async () => {
  const input = event(false, crypto.randomUUID());
  const parsing = spyOn(input.request, 'formData');
  const hashing = spyOn(Bun.password, 'hash').mockImplementation(() => { throw new Error('Unexpected hash.'); });
  try {
    for (let index = 0; index < 12; index++) {
      expect(await actions.default(input)).toMatchObject({ status: 409 });
    }
    expect(parsing).not.toHaveBeenCalled();
    expect(hashing).not.toHaveBeenCalled();
  } finally {
    parsing.mockRestore();
    hashing.mockRestore();
  }
});

test('open setup applies the existing client quota before form parsing or hashing', async () => {
  const address = crypto.randomUUID();
  for (let index = 0; index < 10; index++) checkLoginRate(`setup:${address}`);
  const input = event(true, address);
  const parsing = spyOn(input.request, 'formData');
  const hashing = spyOn(Bun.password, 'hash').mockImplementation(() => { throw new Error('Unexpected hash.'); });
  try {
    expect(await actions.default(input)).toMatchObject({ status: 429 });
    expect(parsing).not.toHaveBeenCalled();
    expect(hashing).not.toHaveBeenCalled();
  } finally {
    parsing.mockRestore();
    hashing.mockRestore();
  }
});

test('the fresh setup fixture passes registration parsing before password work', async () => {
  const hashing = spyOn(Bun.password, 'hash').mockImplementation(() => { throw new Error('Fixture hash boundary.'); });
  try {
    expect(await actions.default(event(true, crypto.randomUUID())))
      .toMatchObject({ status: 400, data: { error: 'Fixture hash boundary.' } });
    expect(hashing).toHaveBeenCalledTimes(1);
  } finally { hashing.mockRestore(); }
});
