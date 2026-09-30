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
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/for-you$/);
  await page.goto(`${origin}/settings/policies`);
  const toggle = page.getByRole('checkbox', { name: 'Enable experimental music and gaming' });
  await expect(toggle).not.toBeChecked();
  const setEnabled = async (enabled: boolean) => {
    await page.goto(`${origin}/settings/policies`);
    await toggle.setChecked(enabled);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/settings/system') && response.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Save system policies' }).click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    expect((await response.json()).experimentalFeatures).toBe(enabled);
    await expect(page.getByRole('status')).toHaveText('Saved.');
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
  expect(
    (
      await page.request.post(`${origin}/api/v1/providers`, {
        headers: { origin },
        data: {
          provider: 'igdb',
          name: 'Disabled IGDB',
          clientId: 'fixture',
          clientSecret: 'fixture',
        },
      })
    ).status()
  ).toBe(404);
  await page.goto(`${origin}/library`);
  await expect(page.getByRole('link', { name: 'Music', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Games', exact: true })).toHaveCount(0);
  await setEnabled(true);
  await page.goto(`${origin}/library`);
  await expect(page.getByRole('link', { name: 'Music', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Games', exact: true })).toBeVisible();
  expect((await page.request.get(`${origin}/music`)).status()).toBe(200);
  expect((await page.request.get(`${origin}/games`)).status()).toBe(200);
  const gameResponse = await page.request.post(`${origin}/api/v1/games`, {
    headers: { origin },
    data: { title: 'Experimental gate preservation fixture' },
  });
  expect(gameResponse.ok()).toBe(true);
  const game = await gameResponse.json();
  // Members can use enabled features but cannot change the global policy.
  const memberName = `experiment-${Date.now()}`;
  expect(
    (
      await page.request.post(`${origin}/api/v1/admin/users`, {
        headers: { origin },
        data: { username: memberName, password: 'Experiment-member-passphrase-2026!' },
      })
    ).ok()
  ).toBe(true);
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await member.goto(`${origin}/login`);
  await member.locator('input[name="username"]').fill(memberName);
  await member.locator('input[name="password"]').fill('Experiment-member-passphrase-2026!');
  await member.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(member).toHaveURL(/\/for-you$/);
  expect((await memberContext.request.get(`${origin}/games`)).status()).toBe(200);
  expect((await memberContext.request.get(`${origin}/settings/policies`)).status()).toBe(403);
  expect(
    (
      await memberContext.request.post(`${origin}/api/v1/settings/system`, {
        headers: { origin },
        data: { experimentalFeatures: false },
      })
    ).status()
  ).toBe(403);
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
  await expect(toggle).not.toBeChecked();
  await page.screenshot({ path: '/tmp/coast-consolidated-experimental-settings.png' });
  expect(issues).toEqual([]);
  console.log(
    'PASS experimental toggle: default Off, admin-only control, navigation, direct page/API gates, runtime changes, preserved game data, no browser errors'
  );
} finally {
  await browser.close();
}
