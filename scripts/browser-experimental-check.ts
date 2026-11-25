import { chromium, expect } from '@playwright/test';
const origin = 'http://127.0.0.1:5178';
// Run against a disposable local installation with the existing diagnostic browser fixture account.
const browser = await chromium.launch();
const page = await browser.newPage();
const issues: string[] = [];
page.on('pageerror', (error) => issues.push(error.message));
const gatedPaths = [
  '/api/v1/%67ames',
  '/api/v1/providers/id%2Fmusic',
  '/music',
  '/music/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/item',
  '/games',
  '/games/igdb/source/item',
  '/api/v1/games',
  '/api/v1/game-playthroughs/id',
  '/api/v1/providers/id/music',
  '/api/v1/providers/id/music/item/artwork',
];
try {
  await page.goto(`${origin}/login`);
  await page.waitForLoadState('networkidle');
  await page.locator('input[name="username"]').fill('diagnostic-browser-admin');
  await page.locator('input[name="password"]').fill('Diagnostic-test-passphrase-2026!');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/for-you$/);
  const setEnabled = async (enabled: boolean) => {
    await page.goto(`${origin}/settings/features-policy`);
    await page.getByRole('button', { name: 'Feature permissions for diagnostic-browser-admin', exact: true }).click();
    for (const name of ['Music', 'Gaming', 'Parties']) {
      await page.getByRole('checkbox', { name: `Allow ${name}`, exact: true }).check();
      await page.getByRole('checkbox', { name: `Enable ${name}`, exact: true }).setChecked(enabled);
    }
    const saved = page.waitForResponse(response => response.url().endsWith('/features') && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Save feature permissions', exact: true }).click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    expect((await response.json()).preferences).toMatchObject({music:enabled,game:enabled,parties:enabled});
  };
  for (const path of gatedPaths)
    expect((await page.request.get(`${origin}${path}`)).status()).toBe(404);
  expect(
    (
      await page.request.post(`${origin}/api/v1/games`, {
        headers: { origin },
        data: { title: 'Disabled write' },
      })
    ).status()
  ).toBe(404);
  await page.goto(`${origin}/library`);
  await expect(page.getByRole('link', { name: 'View all Listen', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'View all Play', exact: true })).toHaveCount(0);
  await setEnabled(true);
  await page.goto(`${origin}/library`);
  await expect(page.getByRole('link', { name: 'View all Listen', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View all Play', exact: true })).toBeVisible();
  expect((await page.request.get(`${origin}/music`)).status()).toBe(200);
  expect((await page.request.get(`${origin}/games`)).status()).toBe(200);
  const gameResponse = await page.request.post(`${origin}/api/v1/games`, {
    headers: { origin },
    data: { title: 'Experimental gate preservation fixture' },
  });
  expect(gameResponse.ok()).toBe(true);
  const game = await gameResponse.json();
  // A grant to one user leaves every other user's feature access unchanged.
  const memberName = `experiment-${Date.now()}`;
  const created = await page.request.post(`${origin}/api/v1/admin/users`, {
    headers: { origin },
    data: { username: memberName, password: 'Experiment-member-passphrase-2026!' },
  });
  expect(created.ok()).toBe(true);
  const { id: memberId } = await created.json();
  const memberFeatures = `${origin}/api/v1/admin/users/${memberId}/features`;
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await member.goto(`${origin}/login`);
  await member.locator('input[name="username"]').fill(memberName);
  await member.locator('input[name="password"]').fill('Experiment-member-passphrase-2026!');
  await member.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(member).toHaveURL(/\/for-you$/);
  expect((await memberContext.request.get(`${origin}/games`)).status()).toBe(404);
  expect((await memberContext.request.patch(memberFeatures, {
    headers: { origin }, data: { permissions: { game: true }, preferences: { game: true } },
  })).status()).toBe(403);
  expect((await page.request.patch(memberFeatures, {
    headers: { origin }, data: { permissions: { game: true }, preferences: { game: true } },
  })).ok()).toBe(true);
  expect((await memberContext.request.get(`${origin}/games`)).status()).toBe(200);
  expect((await memberContext.request.post(`${origin}/api/v1/settings`, {
    headers: { origin }, data: { features: { game: false } },
  })).ok()).toBe(true);
  expect((await page.request.get(memberFeatures)).ok()).toBe(true);
  expect((await (await page.request.get(memberFeatures)).json()).preferences.game).toBe(false);
  await setEnabled(false);
  expect((await memberContext.request.get(`${origin}/api/v1/games`)).status()).toBe(404);
  for (const path of gatedPaths)
    expect((await page.request.get(`${origin}${path}`)).status()).toBe(404);
  await setEnabled(true);
  const preserved = await page.request.get(`${origin}/api/v1/games/${game.id}`);
  expect(preserved.ok()).toBe(true);
  expect((await preserved.json()).title).toBe('Experimental gate preservation fixture');
  await setEnabled(false);
  await page.reload();
  await page.getByRole('button', { name: 'Feature permissions for diagnostic-browser-admin', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Enable Music', exact: true })).not.toBeChecked();
  await page.screenshot({ path: '/tmp/coast-consolidated-experimental-settings.png' });
  expect(issues).toEqual([]);
  console.log(
    'PASS experimental toggle: default Off, per-user grants and preferences, navigation, direct page/API gates, runtime changes, preserved game data, no browser errors'
  );
} finally {
  await browser.close();
}
