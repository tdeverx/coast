// Playwright CLI run-code. Requires a marked real-data copy on loopback 5175.
// Changes only the copied viewer's saved action. Holds an unchanged actual response.
async page => {
  const origin = 'http://127.0.0.1:5175';
  if (new URL(page.url()).origin !== origin) throw Error('Use the owned audit app.');
  const context = await page.context().browser().newContext({ storageState: await page.context().storageState(), viewport: { width: 1440, height: 900 } });
  let release, received;
  const gate = new Promise(resolve => { release = resolve; });
  const held = new Promise(resolve => { received = resolve; });
  let intercepted = 0, delivery = 'not-held';
  try {
    const p = await context.newPage();
    await p.goto(`${origin}/library?view=watch`);
    await p.locator('main article').first().waitFor();
    await p.route('**/api/v1/library?**', async route => {
      const parameters = new URL(route.request().url()).searchParams;
      if (parameters.get('surface') !== 'watch' || parameters.get('page') !== '2') return route.continue();
      intercepted++;
      try {
        const response = await route.fetch();
        received();
        await gate;
        await route.fulfill({ response });
        delivery = 'genuine-response-delivered';
      } catch {
        delivery = 'obsolete-request-aborted';
        received();
      }
    });
    await p.getByRole('button', { name: 'Load more', exact: true }).click();
    await Promise.race([held, new Promise((_, reject) => setTimeout(() => reject(Error('Required actual response missing.')), 20000))]);
    await p.getByRole('button', { name: 'Choose action', exact: true }).click();
    await p.getByRole('menuitemradio', { name: 'Listen', exact: true }).click();
    await p.waitForURL(url => url.pathname === '/library' && url.searchParams.get('view') === 'listen');
    release();
    await p.waitForFunction(() => document.querySelector('main h2')?.textContent?.includes('albums'));
    const before = await p.locator('main article .caption .title').allTextContents();
    await p.waitForTimeout(1200);
    const after = await p.locator('main article .caption .title').allTextContents();
    const action = new URL(p.url()).searchParams.get('view');
    if (intercepted !== 1 || action !== 'listen' || !after.length || JSON.stringify(before) !== JSON.stringify(after)) throw Error('Obsolete response changed the current action.');
    return { scope: 'Actual HTTP body, authored response delivery order; Watch pagination cannot replace a Listen navigation.', intercepted, delivery, action, cards: after.length, stable: true };
  } finally {
    release?.();
    await context.close();
  }
}
