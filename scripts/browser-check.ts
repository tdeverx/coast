import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// Deliberately targets an isolated local instance, never a real installation.
const origin = process.env.COAST_BROWSER_ORIGIN || 'http://127.0.0.1:5175';
if (origin !== 'http://127.0.0.1:5175')
  throw new Error('Run browser checks against the isolated localhost:5175 test instance.');
const output = process.env.COAST_BROWSER_EVIDENCE || '/tmp/coast-browser-evidence';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(10_000);
const issues: { kind: string; message: string }[] = [];
page.on('pageerror', (error) => issues.push({ kind: 'pageerror', message: error.message }));
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning')
    issues.push({ kind: message.type(), message: message.text() });
});
const username = 'coast-browser-admin';
const password = 'Browser-local-passphrase-2026!';
const title = 'The Quiet Shore';
const listName = `Evening Stories ${Date.now().toString().slice(-5)}`;
let step = 'setup';
const checkPage = async () => {
  await expect(page.locator('h1')).toBeVisible();
  expect((await page.locator('body').innerText()).trim().length).toBeGreaterThan(40);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
};
const screenshot = (name: string) =>
  page.screenshot({ path: `${output}/${name}.png`, fullPage: false, animations: 'disabled' });
const accountNavigate = async (name: string) => {
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menu', { name: 'Account menu', exact: true })
    .getByRole('menuitem', { name, exact: true }).click();
};

try {
  await page.goto(`${origin}/setup`);
  await checkPage();
  const isSetup = new URL(page.url()).pathname === '/setup';
  await screenshot(isSetup ? 'setup-desktop' : 'login-desktop');
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page
    .getByRole('button', { name: isSetup ? 'Create your Coast' : 'Sign in', exact: true })
    .click();
  await expect(page).toHaveURL(/\/for-you$/);
  await checkPage();
  console.log('PASS setup / sign-in by pointer');

  step = 'native title';
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  await page.getByRole('button', { name: 'Add a title', exact: true }).click();
  const addDialog = page.getByRole('dialog');
  await expect(addDialog).toBeVisible();
  await addDialog.getByLabel('Title', { exact: true }).fill(title);
  await addDialog.getByLabel('Release year', { exact: false }).fill('2025');
  await addDialog.getByRole('button', { name: 'Add to watchlist', exact: true }).click();
  await expect(page).toHaveURL(/\/media\/[a-f0-9-]+$/);
  const mediaUrl = page.url();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Remove from watchlist', exact: true })
  ).toBeVisible();
  console.log('PASS native title creation and watchlist');

  step = 'tracking and rating';
  await page.getByRole('button', { name: 'More options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Mark watched', exact: true }).click();
  await expect(page.locator('dd').first()).toHaveText('Watched');
  await page.getByRole('combobox', { name: 'Your rating', exact: true }).selectOption('4.5');
  await expect(page.getByRole('combobox', { name: 'Your rating', exact: true })).toHaveValue('4.5');
  await page.getByRole('button', { name: 'Add to favourites', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Remove from favourites', exact: true })
  ).toBeVisible();
  await page.reload();
  await expect(page.locator('dd').first()).toHaveText('Watched');
  await expect(page.getByRole('combobox', { name: 'Your rating', exact: true })).toHaveValue('4.5');
  await screenshot('details-desktop');
  console.log('PASS watched/favourite/rating survive reload');

  step = 'ordered list';
  await accountNavigate('Your lists');
  await page.getByRole('button', { name: 'Create list', exact: true }).click();
  const createDialog = page.getByRole('dialog');
  await createDialog.getByLabel('List name', { exact: true }).fill(listName);
  await createDialog.getByRole('button', { name: 'Create list', exact: true }).click();
  await expect(createDialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: listName, exact: true })).toBeVisible();
  await page.goto(mediaUrl);
  await page.getByRole('button', { name: 'More options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add to a list', exact: true }).click();
  const listMenu = page.getByRole('menu', { name: 'Add to a list', exact: true });
  await listMenu.getByRole('menuitem', { name: listName, exact: true }).click();
  await expect(listMenu).not.toBeVisible();
  await accountNavigate('Your lists');
  await page
    .getByRole('navigation', { name: 'Your lists', exact: true })
    .getByText(listName, { exact: true })
    .click();
  await expect(page.locator(`a[href="${new URL(mediaUrl).pathname}"]`)).toBeVisible();
  console.log('PASS list creation and title membership');

  step = 'metadata overrides and locks';
  await page.goto(mediaUrl);
  await page.getByRole('button', { name: 'Title settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Your poster & title', exact: true }).click();
  let personalDialog = page.getByRole('dialog');
  await personalDialog.getByLabel('Preferred title', { exact: true }).fill('My Quiet Shore');
  await personalDialog.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(personalDialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'My Quiet Shore', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Title settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit shared metadata', exact: true }).click();
  const sharedDialog = page.getByRole('dialog');
  await sharedDialog
    .getByLabel('Preferred title', { exact: true })
    .fill('The Quiet Shore — Shared');
  await sharedDialog
    .getByLabel('Overview', { exact: true })
    .fill('A synthetic title used to verify Coast’s local tracking and presentation controls.');
  await sharedDialog.getByLabel('Lock title', { exact: true }).check();
  await sharedDialog.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(sharedDialog).not.toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'The Quiet Shore — Shared', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Title settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Your poster & title', exact: true }).click();
  personalDialog = page.getByRole('dialog');
  await expect(personalDialog.getByLabel('Preferred title', { exact: true })).toBeDisabled();
  await personalDialog.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(personalDialog).not.toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'The Quiet Shore — Shared', exact: true })
  ).toBeVisible();
  console.log('PASS administrator title lock overrides personal presentation');

  step = 'preferences';
  await accountNavigate('Settings');
  await page.getByLabel('Full-width content', { exact: true }).uncheck();
  await page.getByLabel('Region', { exact: false }).selectOption('US');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  await page.reload();
  await expect(page.getByLabel('Full-width content', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Region', { exact: false })).toHaveValue('US');
  await screenshot('settings-desktop');
  console.log('PASS preferences persisted after reload');

  step = 'mobile';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(mediaUrl);
  await checkPage();
  await screenshot('details-mobile');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow, 'Mobile content overflows the viewport horizontally').toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Settings', exact: true })).toBeVisible();
  await screenshot('account-menu-mobile');
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await checkPage();
  await screenshot('settings-mobile');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  ).toBeLessThanOrEqual(1);
  console.log('PASS mobile layout and pointer menu');

  step = 'logout and login';
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/for-you$/);
  await checkPage();
  await screenshot('home-mobile');
  console.log('PASS logout and mobile sign-in by pointer');
  await Bun.write(`${output}/console.json`, JSON.stringify(issues, null, 2));
  expect(issues, 'Browser console errors or warnings').toEqual([]);
  console.log(`PASS rendered journeys; evidence ${output}`);
} catch (error) {
  await screenshot('failure');
  await Bun.write(
    `${output}/failure.txt`,
    `Step: ${step}\nURL: ${page.url()}\nTitle: ${await page.title()}\n${String(error)}\n\n${await page.locator('body').innerText()}\n\nConsole:\n${JSON.stringify(issues, null, 2)}`
  );
  throw error;
} finally {
  await context.close();
  await browser.close();
}
