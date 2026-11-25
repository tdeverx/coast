import { chromium, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
const origin = 'http://127.0.0.1:5175';
// Synthetic account on a disposable local database, following the existing browser harness.
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const issues: string[] = [];
let step = 'sign in';
page.on('pageerror', (e) => issues.push(e.message));
try {
  await page.goto(`${origin}/setup`);
  await page.waitForTimeout(1000);
  const setup = page.url().endsWith('/setup');
  await page.locator('input[name="username"]').fill('diagnostic-browser-admin');
  await page.locator('input[name="password"]').fill('Diagnostic-test-passphrase-2026!');
  if (setup) {
    await page.locator('input[name="displayName"]').fill('Diagnostic administrator');
    await page.locator('input[name="passwordConfirmation"]').fill('Diagnostic-test-passphrase-2026!');
  }
  await page
    .getByRole('button', { name: setup ? 'Create your Coast' : 'Continue', exact: true })
    .click();
  await expect(page).toHaveURL(/\/for-you$/);
  step = 'settings';
  await page.goto(`${origin}/settings/activity`);
  await page.waitForTimeout(1000);
  const selector = page.getByRole('button', { name: 'Diagnostic logging', exact: true });
  const options = page.getByRole('group', { name: 'Diagnostic logging options', exact: true });
  const label = (level: string) => level[0].toUpperCase() + level.slice(1);
  const selectLevel = async (level: string) => {
    await selector.click();
    await options.getByRole('button', { name: label(level), exact: true }).click();
  };
  await expect(selector).toHaveAccessibleDescription('Info');
  await selector.click();
  expect(await options.getByRole('button').allTextContents().then(rows => rows.slice(1).map(text => text.trim()))).toEqual([
    'Off',
    'Error',
    'Warn',
    'Info',
    'Debug',
    'Trace',
  ]);
  await selector.press('Escape');
  for (const level of ['trace', 'off', 'info']) {
    step = `save ${level}`;
    await selectLevel(level);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/settings/system') && response.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await expect(page.getByRole('status')).toContainText('Diagnostic logging updated.');
    expect((await (await page.request.get(`${origin}/api/v1/diagnostics`)).json()).level).toBe(
      level
    );
    await page.reload();
    await page.waitForTimeout(1000);
    await expect(selector).toHaveAccessibleDescription(label(level));
  }
  await selectLevel('trace');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Diagnostic logging updated.');
  const id = crypto.randomUUID();
  const spoofedRequestId = crypto.randomUUID();
  const health = await page.request.get(`${origin}/api/v1/health`, {
    headers: { 'x-coast-correlation-id': id, 'x-coast-request-id': spoofedRequestId },
  });
  expect(health.ok()).toBe(true);
  const requestId = health.headers()['x-coast-request-id'];
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(requestId).not.toBe(spoofedRequestId);
  const result = await page.request.post(`${origin}/api/v1/diagnostics`, {
    headers: { origin, 'x-coast-correlation-id': id },
    data: {
      event: 'playback.timing',
      fields: {
        positionSeconds: 12,
        sessionId: crypto.randomUUID(),
        password: 'SENSITIVE_TEST_MARKER',
        url: 'https://private.invalid/personal',
      },
    },
  });
  expect(result.status()).toBe(204);
  const browserReport = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/diagnostics') && response.request().method() === 'POST'
  );
  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'SENSITIVE_TEST_MARKER' }));
  });
  expect((await browserReport).status()).toBe(204);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Diagnostic settings', exact: true }).click();
  await page.getByRole('button', { name: 'Events', exact: true }).click();
  await page.getByRole('link', { name: 'Download recent diagnostics' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('coast-diagnostics.jsonl');
  const content = await readFile((await file.path())!, 'utf8');
  expect(content).not.toContain('SENSITIVE_TEST_MARKER');
  expect(content).not.toContain('private.invalid');
  expect(content).toContain(id);
  expect(content).toContain('playback.timing');
  expect(content).toContain('browser.error');
  const rows = content.trim().split('\n').map(line => JSON.parse(line));
  expect(rows).toContainEqual(expect.objectContaining({
    kind: 'request.complete', level: 'debug', correlationId: id, requestId,
    detail: expect.objectContaining({ requestAction: 'health', status: 200 }),
  }));
  expect(content).not.toContain(spoofedRequestId);
  await page.getByRole('button', { name: 'Diagnostic settings', exact: true }).click();
  await page.getByRole('button', { name: 'Logging', exact: true }).click();
  await selectLevel('info');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Diagnostic logging updated.');
  await mkdir('/tmp/coast-diagnostic-evidence', { recursive: true });
  await page.screenshot({ path: '/tmp/coast-diagnostic-evidence/settings.png', fullPage: true });
  // Create a synthetic member through the existing administrative API.
  const memberName = `diagnostic-member-${Date.now()}`;
  const member = await page.request.post(`${origin}/api/v1/admin/users`, {
    headers: { origin },
    data: { username: memberName, password: 'Diagnostic-member-passphrase-2026!' },
  });
  expect(member.ok()).toBe(true);
  const context = await browser.newContext();
  const memberPage = await context.newPage();
  await memberPage.goto(`${origin}/login`);
  await memberPage.waitForTimeout(1000);
  await memberPage.locator('input[name="username"]').fill(memberName);
  await memberPage.locator('input[name="password"]').fill('Diagnostic-member-passphrase-2026!');
  await memberPage.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(memberPage).toHaveURL(/\/for-you$/);
  expect((await context.request.get(`${origin}/api/v1/diagnostics?download`)).status()).toBe(403);
  const adminConfig = await page.request.get(`${origin}/settings/activity`);
  expect(adminConfig.ok()).toBe(true);
  expect(
    (
      await context.request.post(`${origin}/api/v1/settings/system`, {
        headers: { origin },
        data: {},
      })
    ).status()
  ).toBe(403);
  await memberPage.goto(`${origin}/settings`);
  await expect(
    memberPage.getByRole('button', { name: 'Diagnostic logging', exact: true })
  ).toHaveCount(0);
  expect(issues).toEqual([]);
  console.log(
    'PASS browser: default/options, live changes, persistence, audit, redacted correlated download, admin access, no page errors'
  );
} catch (error) {
  console.error(`Browser diagnostic step: ${step}`);
  throw error;
} finally {
  await browser.close();
}
