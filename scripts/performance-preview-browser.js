// Replace the sentinel in a private copy of this script with an existing real image.
// Never commit the image, its private path or browser session. Playwright CLI run-code.
async page => {
  const origin = 'http://127.0.0.1:5175', realImage = 'REPLACE_WITH_PRIVATE_REAL_IMAGE_PATH';
  if (new URL(page.url()).origin !== origin || realImage.startsWith('REPLACE_')) throw Error('An owned audit app and actual encoded image are required.');
  const context = await page.context().browser().newContext({ storageState: await page.context().storageState(), viewport: { width: 1440, height: 900 } });
  try {
    const p = await context.newPage();
    await p.addInitScript(() => {
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      window.__coastImageAudit = { created: 0, revoked: 0, active: new Set() };
      URL.createObjectURL = blob => { const url = create(blob); window.__coastImageAudit.created++; window.__coastImageAudit.active.add(url); return url; };
      URL.revokeObjectURL = url => { window.__coastImageAudit.revoked++; window.__coastImageAudit.active.delete(url); revoke(url); };
    });
    await p.goto(`${origin}/ui-preview`);
    await p.getByRole('group', { name: 'Preview background', exact: true }).getByRole('button', { name: 'Image', exact: true }).click();
    const input = p.locator('input[type=file][accept="image/*"]'), samples = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      await input.setInputFiles(realImage);
      await p.waitForFunction(() => { const image = document.querySelector('.playground-background img'); return image?.complete && image.naturalWidth > 0; });
      samples.push(await p.locator('.playground-background img').evaluate(image => ({ width: image.naturalWidth, height: image.naturalHeight })));
      await p.getByRole('button', { name: 'Remove image', exact: true }).click();
      await p.locator('.playground-background img').waitFor({ state: 'detached' });
      if (await input.evaluate(element => element.files.length) !== 0) throw Error('Removed file still selected.');
    }
    const urls = await p.evaluate(() => ({ created: window.__coastImageAudit.created, revoked: window.__coastImageAudit.revoked, active: window.__coastImageAudit.active.size }));
    if (urls.created !== 3 || urls.revoked !== 3 || urls.active) throw Error('Background image object URL ownership leaked.');
    return { scope: 'Same genuine encoded image selected and removed three times; no GPU or maximum image budget claim.', samples, urls };
  } finally { await context.close(); }
}
