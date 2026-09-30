import { chromium, expect, type Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// Run only after provider-browser-fixture.ts against the disposable test installation.
const origin = 'http://127.0.0.1:5175';
const mediaId = process.env.COAST_BROWSER_MEDIA_ID;
if (!mediaId || !/^[a-f0-9-]{36}$/.test(mediaId))
  throw new Error('Set COAST_BROWSER_MEDIA_ID to the synthetic fixture movie.');
const showId = process.env.COAST_BROWSER_SHOW_ID;
const episodeOneId = process.env.COAST_BROWSER_EPISODE_ONE_ID;
const episodeTwoId = process.env.COAST_BROWSER_EPISODE_TWO_ID;
const specialId = process.env.COAST_BROWSER_SPECIAL_ID;
if (
  [showId, episodeOneId, episodeTwoId].some(Boolean) &&
  ![showId, episodeOneId, episodeTwoId].every((id) => id && /^[a-f0-9-]{36}$/.test(id))
)
  throw new Error('Provide all three synthetic show and episode IDs to verify continuation.');
const output = '/tmp/coast-browser-evidence';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const heroVideo = page.locator('video[data-player="hero"]');
const playbackVideo = page.locator('video[data-player="playback"]');
const chrome = page.locator('.playback-chrome');
const header = page.locator('header').first();
const forceHlsJs = process.env.COAST_BROWSER_FORCE_HLS_JS === '1';
if (forceHlsJs) {
  await page.addInitScript(() => {
    const nativeCanPlayType = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function (type) {
      return /application\/(?:vnd\.apple\.mpegurl|x-mpegurl)/i.test(type)
        ? ''
        : nativeCanPlayType.call(this, type);
    };
  });
  console.log(
    'SIMULATED CAPABILITY: only native HLS MIME support is disabled to exercise real hls.js decoding.'
  );
}
page.setDefaultTimeout(10_000);
const issues: { kind: string; message: string }[] = [];
const playbackReports: { sessionId: string; event: string }[] = [];
let preparationRequests = 0;
page.on('request', (request) => {
  if (request.url() === `${origin}/api/v1/playback` && request.method() === 'POST')
    preparationRequests++;
  const match = /\/api\/v1\/playback\/([a-f0-9-]+)\/progress$/.exec(request.url());
  if (match && request.method() === 'POST')
    playbackReports.push({ sessionId: match[1], event: request.postDataJSON().event });
});
page.on('pageerror', (error) => issues.push({ kind: 'pageerror', message: error.message }));
page.on('console', (message) => {
  if (['error', 'warning'].includes(message.type()))
    issues.push({ kind: message.type(), message: message.text() });
});
let step = 'sign-in';
const screenshot = (name: string) =>
  page.screenshot({
    path: `${output}/${name}${forceHlsJs ? '-hlsjs' : ''}.png`,
    animations: 'disabled',
  });
async function hydrated() {
  await expect.poll(() => page.locator('.page-shell').evaluate(element =>
    (element as HTMLElement).style.getPropertyValue('--active-hero-height')
  )).not.toBe('');
}
function readVideo(locator: Locator) {
  return locator.evaluate((element) => {
    const video = element as HTMLVideoElement;
    return {
      currentTime: video.currentTime,
      currentSrc: video.currentSrc,
      paused: video.paused,
      muted: video.muted,
      readyState: video.readyState,
      error: video.error?.code ?? null,
      subtitleMode: video.textTracks[0]?.mode,
      nativeHls: !!video.canPlayType('application/vnd.apple.mpegurl'),
    };
  });
}
async function openPlaybackMenu(name: string) {
  const trigger=page.getByRole('button', { name: 'Playback options', exact: true });
  await trigger.focus();
  await trigger.press('ArrowDown');
  await page.getByRole('menuitem',{name,exact:true}).press('ArrowRight');
  const menu = page.getByRole('menu', { name, exact: true });
  await expect(menu).toBeVisible();
  return menu;
}
async function seekTo(seconds: number) {
  // Exercise the timeline's native input/change boundary without calling player internals.
  await page.mouse.move(22, 22);
  const timeline = page.getByRole('slider', { name: 'Playback position', exact: true });
  await expect(timeline).toBeEnabled();
  await timeline.evaluate((element, position) => {
    const input = element as HTMLInputElement;
    input.value = String(position);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, seconds);
}
try {
  const stored=Bun.file('/private/tmp/coast-fixture-browser-session.json');
  if(await stored.exists())await page.context().addCookies(JSON.parse(await stored.text()).cookies);
  await page.goto(`${origin}/for-you`);
  if(page.url().includes('/login')){await page.locator('input[name=username]').fill('fixtureadmin');await page.locator('input[name=password]').fill('Coast-fixture-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();}
  await expect(page).toHaveURL(/\/for-you$/);
  await page.context().storageState({path:'/private/tmp/coast-fixture-browser-session.json'});
  step = 'subtitle preferences';
  await page.goto(`${origin}/settings/playback`);
  await page.waitForLoadState('domcontentloaded');
  const ask=page.getByLabel('Ask before playback', { exact: true });
  if(!await ask.isChecked()){await ask.check();await page.getByRole('button', { name: 'Save playback preferences', exact: true }).click();await expect(page.getByRole('status')).toHaveText('Preferences saved.');}
  await page.goto(`${origin}/media/${mediaId}`);
  await hydrated();
  await expect(
    page.getByRole('heading', { name: 'Coast Playback Fixture', exact: true })
  ).toBeVisible();
  await expect(heroVideo).toHaveCount(1);
  await expect(playbackVideo).toHaveCount(1);
  const originalVideo = await playbackVideo.elementHandle();
  const originalHero = await heroVideo.elementHandle();
  if (!originalVideo || !originalHero) throw new Error('A persistent video is missing.');
  step = 'hero trailer';
  await expect(page.getByRole('button', { name: 'Pause trailer', exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect
    .poll(async () => (await readVideo(heroVideo)).currentSrc)
    .toContain('/api/v1/trailer/');
  await expect.poll(async () => (await readVideo(heroVideo)).muted).toBe(true);
  await expect(page.locator('.art.video-visible')).toBeVisible({ timeout: 10_000 });
  await screenshot('hero-trailer-desktop');
  await page.getByRole('button', { name: 'Pause trailer', exact: true }).click();
  await expect.poll(async () => (await readVideo(heroVideo)).paused).toBe(true);
  await page.getByRole('button', { name: 'Play trailer', exact: true }).click();
  await expect.poll(async () => (await readVideo(heroVideo)).paused).toBe(false);
  console.log('PASS muted hero trailer and pause/resume');
  step = 'cancel subtitle prompt without playback activity';
  const preparedResponse = page.waitForResponse(
    (response) =>
      response.url() === `${origin}/api/v1/playback` && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: /^(Play|Resume)$/ }).click();
  const preparedSession = await (await preparedResponse).json();
  const prompt = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Subtitles', exact: true }) });
  await expect(prompt).toBeVisible();
  expect(playbackReports.filter((report) => report.sessionId === preparedSession.id)).toEqual([]);
  await prompt.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close player', exact: true })).not.toBeVisible();
  expect(playbackReports.filter((report) => report.sessionId === preparedSession.id)).toEqual([
    { sessionId: preparedSession.id, event: 'stop' },
  ]);
  console.log(
    'PASS subtitle prompt cancellation closes the prepared session without starting playback'
  );
  step = 'direct playback and subtitle prompt';
  await page.getByRole('button', { name: /^(Play|Resume)$/ }).click();
  await expect(prompt).toBeVisible();
  await prompt.locator('select').selectOption('1');
  await prompt.getByRole('button', { name: 'Start playback', exact: true }).click();
  await expect(prompt).not.toBeVisible();
  await expect
    .poll(() => readVideo(playbackVideo))
    .toMatchObject({ paused: false, error: null });
  await expect
    .poll(async () => (await readVideo(playbackVideo)).currentTime)
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await readVideo(playbackVideo)).subtitleMode)
    .toBe('showing');
  expect(await playbackVideo.getAttribute('src')).toContain('/api/v1/playback/');
  await screenshot('player-desktop');
  expect(
    await originalVideo.evaluate(
      (video) => video === document.querySelector('video[data-player="playback"]') && video.isConnected
    )
  ).toBe(true);
  expect(await originalHero.evaluate((video) =>
    video === document.querySelector('video[data-player="hero"]') && video.isConnected
  )).toBe(true);
  await expect.poll(async () => (await readVideo(heroVideo)).paused).toBe(true);
  console.log(
    'PASS direct playback and prompted subtitles on the title video; hero remains independent and paused'
  );

  step = 'subtitle off and on';
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await (await openPlaybackMenu('Subtitles')).getByRole('menuitemradio', { name: /^Off/ }).click();
  await expect
    .poll(async () => (await readVideo(playbackVideo)).subtitleMode)
    .toBe('disabled');
  await (await openPlaybackMenu('Subtitles')).getByRole('menuitemradio', { name: /^English/ }).click();
  await expect
    .poll(async () => (await readVideo(playbackVideo)).subtitleMode)
    .toBe('showing');
  console.log('PASS subtitle off/on uses the real text track');
  await page.locator('.playback-chrome').getByRole('button',{name:'Play',exact:true}).click();

  step = 'navigation and progress';
  await page.mouse.move(20, 20);
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect.poll(async () => (await readVideo(playbackVideo)).paused).toBe(true);
  await expect(page.locator('.page-shell')).toHaveAttribute('aria-hidden', 'false');
  await expect(heroVideo).toHaveCount(1);
  await expect(playbackVideo).toHaveCount(1);
  expect(
    await originalVideo.evaluate(
      (video) => video === document.querySelector('video[data-player="playback"]') && video.isConnected
    )
  ).toBe(true);
  await seekTo(18);
  await expect
    .poll(async () => (await readVideo(playbackVideo)).currentTime)
    .toBeGreaterThanOrEqual(18);
  await page.getByRole('button', { name: 'Close player', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close player', exact: true })).not.toBeVisible();
  await page.goto(`${origin}/media/${mediaId}`);
  await hydrated();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Start playback', exact: true })
    .click();
  await expect
    .poll(async () => (await readVideo(playbackVideo)).currentTime)
    .toBeGreaterThanOrEqual(17);
  console.log('PASS title video persists while navigation pauses playback, with saved progress and resume');

  step = 'HLS source';
  await page.getByRole('button',{name:'Close player',exact:true}).click();
  await page.goto(`${origin}/media/${mediaId}`);
  await hydrated();
  // Simulate a device requiring transcoding, using the unchanged Play control.
  await page.route('**/api/v1/playback',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    const body=route.request().postDataJSON();body.browser.containers=[];
    await route.continue({postData:JSON.stringify(body)});
  });
  const hlsResponse = page.waitForResponse(response=>response.url()===`${origin}/api/v1/playback`&&response.request().method()==='POST');
  await page.getByRole('button',{name:/^(Play|Resume)$/}).click();
  const hlsSession = await (await hlsResponse).json();
  expect(hlsSession.kind).toBe('hls');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Start playback', exact: true })
    .click();
  const nativeHls = (await readVideo(playbackVideo)).nativeHls;
  if (nativeHls)
    await expect
      .poll(async () => (await readVideo(playbackVideo)).currentSrc)
      .toBe(`${origin}${hlsSession.url}`);
  else
    await expect
      .poll(async () => (await readVideo(playbackVideo)).currentSrc)
      .toMatch(/^blob:/);
  await expect
    .poll(async () => (await readVideo(playbackVideo)).readyState)
    .toBeGreaterThanOrEqual(2);
  await expect.poll(async () => (await readVideo(playbackVideo)).paused).toBe(false);
  await expect(page.getByRole('alert')).not.toBeVisible();
  const hlsTime = (await readVideo(playbackVideo)).currentTime;
  await expect
    .poll(async () => (await readVideo(playbackVideo)).currentTime)
    .toBeGreaterThan(hlsTime + 0.5);
  await screenshot('player-hls-desktop');
  console.log(`PASS HLS source through ${nativeHls ? 'native HLS' : 'hls.js'}`);

  step = 'mobile playback';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.mouse.move(20, 20);
  await expect(page.getByRole('button', { name: 'Close player', exact: true })).toBeVisible();
  await screenshot('player-mobile');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  ).toBeLessThanOrEqual(1);
  step = 'automatic inactivity controls and pause-to-browse';
  await expect(chrome).toHaveClass(/chrome-hidden/, { timeout: 8_000 });
  await expect(header).toHaveClass(/chrome-hidden/);
  await page.mouse.move(21, 21);
  await expect(chrome).not.toHaveClass(/chrome-hidden/);
  await expect(header).not.toHaveClass(/chrome-hidden/);
  await chrome.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(async () => (await readVideo(playbackVideo)).paused).toBe(true);
  await expect(page.locator('.page-shell')).toHaveAttribute('aria-hidden', 'false');
  await expect(chrome).not.toHaveClass(/chrome-hidden/);
  await expect(header).not.toHaveClass(/chrome-hidden/);
  await expect.poll(async () => (await readVideo(heroVideo)).paused).toBe(false);
  const pausedPosition = (await readVideo(playbackVideo)).currentTime;
  const preparationsBeforeResume = preparationRequests;
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect.poll(async () => (await readVideo(playbackVideo)).paused).toBe(false);
  await expect
    .poll(async () => (await readVideo(playbackVideo)).currentTime)
    .toBeGreaterThanOrEqual(pausedPosition);
  await expect.poll(async () => (await readVideo(heroVideo)).paused).toBe(true);
  expect(preparationRequests).toBe(preparationsBeforeResume);
  await expect(page.locator('.page-shell')).toHaveAttribute('aria-hidden', 'true');
  console.log('PASS inactivity hides both control layers; pause reveals browsing and the hero; resume reuses the title session');
  step = 'completion and post-play';
  await seekTo(58);
  await expect(
    page.getByRole('heading', { name: 'One more story, remembered.', exact: true })
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Your watch history is up to date.', { exact: true })).toBeVisible();
  await screenshot('postplay-mobile');
  await page.getByRole('button', { name: 'Back to Coast', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close player', exact: true })).not.toBeVisible();
  await expect(page.getByText('Marked as watched', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  console.log('PASS ended playback saves watch history and renders post-play');
  if (showId && episodeOneId && episodeTwoId) {
    step = 'show hero and first episode';
    const reset = await page.request.post(`${origin}/api/v1/tracking/bulk`, {
      headers: { Origin: origin },
      data: { mediaId: showId, action: 'unwatch', acknowledged: true },
    });
    expect(reset.ok()).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${origin}/media/${showId}`);
    await hydrated();
    await page.waitForLoadState('domcontentloaded');
    await expect(
      page.getByRole('heading', { name: 'Coast Series Fixture', exact: true })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play S01E01', exact: true })).toBeVisible();
    const showVideo = await playbackVideo.elementHandle();
    if (!showVideo) throw new Error('The persistent show player is missing.');
    const nextSession = () =>
      page.waitForResponse(
        (response) =>
          response.url() === `${origin}/api/v1/playback` && response.request().method() === 'POST'
      );
    const firstResponse = nextSession();
    await page.getByRole('button', { name: 'Play S01E01', exact: true }).click();
    const firstEpisode = await (await firstResponse).json();
    expect(firstEpisode.mediaId).toBe(episodeOneId);
    await prompt.getByRole('button', { name: 'Start playback', exact: true }).click();
    await expect
      .poll(async () => (await readVideo(playbackVideo)).currentTime)
      .toBeGreaterThan(0);
    await expect(page.locator('.playback-chrome .track-copy strong')).toHaveText('Coast Episode One');
    await seekTo(58);
    const postplay = page.locator('.postplay');
    await expect(postplay.getByRole('button', { name: 'Play S01E02', exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await screenshot('episode-next-desktop');
    const firstState = await (await page.request.get(`${origin}/api/v1/media/${showId}`)).json();
    expect(firstState.item.completedEpisodes).toBe(1);
    expect(firstState.item.watched).toBe(false);
    step = 'post-play next episode on the persistent video';
    const secondResponse = nextSession();
    await postplay.getByRole('button', { name: 'Play S01E02', exact: true }).click();
    const secondEpisode = await (await secondResponse).json();
    expect(secondEpisode.mediaId).toBe(episodeTwoId);
    await prompt.getByRole('button', { name: 'Start playback', exact: true }).click();
    await expect(page.locator('.playback-chrome .track-copy strong')).toHaveText('Coast Episode Two');
    await expect
      .poll(async () => (await readVideo(playbackVideo)).currentTime)
      .toBeGreaterThan(0);
    expect(
      await showVideo.evaluate(
        (video) => video === document.querySelector('video[data-player="playback"]') && video.isConnected
      )
    ).toBe(true);
    await expect(playbackVideo).toHaveCount(1);
    await seekTo(18);
    await expect
      .poll(async () => (await readVideo(playbackVideo)).currentTime)
      .toBeGreaterThanOrEqual(18);
    await page.getByRole('button', { name: 'Close player', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resume S01E02', exact: true })).toBeVisible();
    step = 'resume next episode and complete regular episodes';
    const resumeResponse = nextSession();
    await page.getByRole('button', { name: 'Resume S01E02', exact: true }).click();
    const resumedEpisode = await (await resumeResponse).json();
    expect(resumedEpisode.mediaId).toBe(episodeTwoId);
    expect(resumedEpisode.startSeconds).toBeGreaterThanOrEqual(17);
    await prompt.getByRole('button', { name: 'Start playback', exact: true }).click();
    await expect
      .poll(async () => (await readVideo(playbackVideo)).currentTime)
      .toBeGreaterThanOrEqual(17);
    await seekTo(58);
    await expect(
      postplay.getByText('Your watch history is up to date.', { exact: true })
    ).toBeVisible({ timeout: 10_000 });
    await expect(postplay.getByRole('button', { name: /^Play S/ })).not.toBeVisible();
    await postplay.getByRole('button', { name: 'Back to Coast', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Close player', exact: true })).not.toBeVisible();
    const completedShow = await (await page.request.get(`${origin}/api/v1/media/${showId}`)).json();
    expect(completedShow.item.completedEpisodes).toBe(2);
    expect(completedShow.item.totalEpisodes).toBe(2);
    expect(completedShow.item.watched).toBe(true);
    if (specialId) {
      const special = await (await page.request.get(`${origin}/api/v1/media/${specialId}`)).json();
      expect(special.item.watched).toBe(false);
    }
    expect(
      await showVideo.evaluate(
        (video) => video === document.querySelector('video[data-player="playback"]') && video.isConnected
      )
    ).toBe(true);
    await screenshot('show-completed-desktop');
    console.log(
      'PASS show hero, next episode, persistent title video, episode resume and regular-only show completion'
    );
  }
  await Bun.write(
    `${output}/playback-console${forceHlsJs ? '-hlsjs' : ''}.json`,
    JSON.stringify(issues, null, 2)
  );
  expect(issues).toEqual([]);
  console.log('PASS mobile controls; no console errors or warnings');
} catch (error) {
  await screenshot('playback-failure');
  await Bun.write(
    `${output}/playback-failure${forceHlsJs ? '-hlsjs' : ''}.txt`,
    `Step: ${step}\nURL: ${page.url()}\n${String(error)}\n\n${await page.locator('body').innerText()}\n\n${JSON.stringify(issues, null, 2)}`
  );
  throw error;
} finally {
  await browser.close();
}
