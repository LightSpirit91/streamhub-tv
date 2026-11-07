/**
 * End-to-end Chromecast test with a simulated Cast SDK (no TV needed).
 * 1) npx expo export -p web --output-dir /tmp/site/streamhub-tv
 * 2) python3 -m http.server 8776 -d /tmp/site
 * 3) node e2e/cast.e2e.js   (BASE_URL to override)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const S = process.argv[2] || require('os').tmpdir();
const BASE = process.env.BASE_URL || 'http://localhost:8776/streamhub-tv/';
(async () => {
  const b = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost' } } : {});
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/gstatic\.com\/cv\/js\/sender/, (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(__dirname + '/fake-cast-sdk.js', 'utf8') }));
  // Casting is about titles that play inside StreamHub; free-elsewhere titles (they open on Tubi etc.) are left out here.
  await ctx.route(/catalog\/(movies|shows)\.json/, async (route) => {
    const res = await route.fetch();
    const j = await res.json();
    if (j.movies) j.movies = j.movies.filter((m) => m.source !== 'free');
    if (j.shows) j.shows = j.shows.filter((x) => x.source !== 'free');
    await route.fulfill({ response: res, json: j });
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const log = async () => p.evaluate(() => window.__castLog.map((x) => x.join(' | ')));
  const step = async (name, fn) => { try { await fn(); console.log('PASS', name); } catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0]); } };
  const lastLoad = async () => (await log()).filter((x) => x.startsWith('load')).pop() || '';
  await p.goto(BASE);
  await p.waitForSelector("text=Who's watching?", { timeout: 60000 });
  await p.click('text=Arkadi');
  await p.waitForSelector('text=Watch live', { timeout: 60000 });

  await step('Cast button appears in the top bar', async () => { await p.waitForSelector('[aria-label="Cast to TV"]', { timeout: 10000 }); });
  await step('Connect from the top bar', async () => { await p.click('[aria-label="Cast to TV"]'); await p.waitForSelector('text=Living Room TV', { timeout: 5000 }); });
  await step('Home: Watch live plays on the TV, nothing locally', async () => {
    await p.click('text=Watch live'); await p.waitForSelector('text=Playing on Living Room TV', { timeout: 5000 });
    const l = await lastLoad(); if (!/LIVE/.test(l)) throw new Error('no live load: ' + l);
    if (await p.locator('video').count()) throw new Error('local video still rendered');
  });
  await step('Channel down follows to the TV', async () => {
    const before = await lastLoad(); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(1200);
    const after = await lastLoad(); if (after === before) throw new Error('no new load');
  });
  await step('Pause/Play controls the TV', async () => {
    await p.click('[aria-label="Pause"]'); await p.waitForTimeout(300);
    if (!(await log()).some((x) => x.startsWith('playOrPause | true'))) throw new Error('not paused');
    await p.click('[aria-label="Play"]');
  });
  await step('Keyboard Space after clicking a button toggles once', async () => {
    const n0 = (await log()).filter((x) => x.startsWith('playOrPause')).length;
    await p.keyboard.press('Space'); await p.waitForTimeout(300);
    const n1 = (await log()).filter((x) => x.startsWith('playOrPause')).length;
    if (n1 - n0 !== 1) throw new Error(`toggled ${n1 - n0} times`);
    await p.keyboard.press('Space');
  });
  await step('Volume and mute control the TV', async () => {
    await p.click('[aria-label="Volume down"]'); await p.click('[aria-label="Mute"]'); await p.waitForTimeout(300);
    const l = await log(); if (!l.some((x) => x.startsWith('volume | 0.9')) || !l.some((x) => x.startsWith('mute'))) throw new Error(l.slice(-4).join(' / '));
  });
  await step('Leaving the player keeps the TV playing, Now on TV bar shows', async () => {
    await p.keyboard.press('Escape'); await p.waitForSelector('[aria-label="Open remote"]', { timeout: 5000 });
    if ((await log()).includes('end')) throw new Error('session ended');
  });
  await step('Movies: Play a film sends an MP4 to the TV', async () => {
    await p.click('[aria-label="Movies tab"]'); await p.waitForTimeout(1500); await p.getByText('Details', { exact: true }).first().click(); await p.waitForTimeout(800);
    await p.getByRole('button', { name: /^(Play|Resume)/ }).last().click();
    await p.waitForTimeout(1200);
    const l = await lastLoad();
    const ytHint = await p.locator('text=This title is from YouTube').count();
    if (!/video\/mp4 \| BUFFERED/.test(l) && !ytHint) throw new Error(l);
  });
  await step('Movie seek controls the TV', async () => {
    if (await p.locator('text=This title is from YouTube').count()) return; // YouTube plays locally; seek is local
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(400);
    if (!(await log()).some((x) => x.startsWith('seek'))) throw new Error('no seek');
  });
  await step('Shows: an episode plays on the TV', async () => {
    await p.keyboard.press('Escape'); await p.click('[aria-label="Shows tab"]'); await p.waitForTimeout(1500);
    const before = await lastLoad(); await p.getByRole('button', { name: 'Play', exact: true }).first().click(); await p.waitForTimeout(1200);
    const l = await lastLoad();
    const ytHint = await p.locator('text=This title is from YouTube').count();
    if ((l === before || !/BUFFERED/.test(l)) && !ytHint) throw new Error(l);
  });
  await step('Live TV guide: preview does not play locally while casting', async () => {
    await p.keyboard.press('Escape'); await p.click('[aria-label="Live TV tab"]'); await p.waitForTimeout(1500);
    await p.waitForSelector('text=Casting to Living Room TV', { timeout: 5000 });
    if (await p.locator('video').count()) throw new Error('local preview video playing');
  });
  await step('Live TV guide: Enter sends the selected channel to the TV', async () => {
    const before = await lastLoad(); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(700); await p.keyboard.press('Enter'); await p.waitForTimeout(1200);
    const l = await lastLoad(); if (l === before) throw new Error('no new load');
  });
  await step('Search: a result plays on the TV', async () => {
    await p.keyboard.press('Escape'); await p.click('[aria-label="Search tab"]'); await p.fill('input', 'news'); await p.waitForTimeout(800);
    const before = await lastLoad(); await p.locator('[aria-label*="US"]').first().click(); await p.waitForTimeout(1200);
    const l = await lastLoad(); if (l === before) throw new Error('no new load');
  });
  await step('Stop casting from the Now on TV bar; local playback works again', async () => {
    await p.keyboard.press('Escape'); await p.click('[aria-label="Stop casting"]'); await p.waitForTimeout(500);
    if (!(await log()).includes('end')) throw new Error('not ended');
    await p.click('[aria-label="Home tab"]'); await p.waitForTimeout(500); await p.click('text=Watch live'); await p.waitForTimeout(1500);
    if (!(await p.locator('video').count())) throw new Error('local video not back');
  });
  console.log('LOG:\n  ' + (await log()).join('\n  '));
  console.log('ERRORS', errs);
  await p.screenshot({ path: S + '/cast-final.png' });
  await b.close();
})();
