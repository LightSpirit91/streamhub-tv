/**
 * OpenSubtitles in the player, against a simulated StreamHub subtitle
 * backend (build with EXPO_PUBLIC_SUBTITLES_API=https://subs-backend.test).
 * Search, choose, show, remember (no second download), daily limit, none found.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:8776/streamhub-tv/';

(async () => {
  const b = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost' } } : {});
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  let downloads = 0;
  let quotaLeft = 1;
  await ctx.route(/catalog\/movies\.json/, async (route) => {
    const res = await route.fetch();
    const j = await res.json();
    j.movies = j.movies.filter((m) => m.source === 'archive').slice(0, 40).map((m, i) => ({ ...m, subs: [], imdbId: i === 0 ? 'tt0051744' : `tt99${i}` }));
    await route.fulfill({ response: res, json: j });
  });
  await ctx.route('https://subs-backend.test/**', async (route) => {
    const u = new URL(route.request().url());
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (u.pathname === '/search') {
      if (u.searchParams.get('lang') === 'ru') return route.fulfill({ status: 404, headers: cors, json: { error: 'notfound' } });
      return route.fulfill({ headers: cors, json: { results: [
        { fileId: { es: 11, he: 21, en: 31 }[u.searchParams.get('lang')], lang: u.searchParams.get('lang'), release: 'House.on.Haunted.Hill.1959.720p', downloads: 5400, hearingImpaired: false },
        { fileId: { es: 12, he: 22, en: 32 }[u.searchParams.get('lang')], lang: u.searchParams.get('lang'), release: 'House on Haunted Hill DVDRip', downloads: 900, hearingImpaired: true },
      ] } });
    }
    if (u.pathname === '/download') {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST' } });
      if (quotaLeft <= 0) return route.fulfill({ status: 429, headers: cors, json: { error: 'quota', resetTime: '2026-11-08T05:00:00Z' } });
      quotaLeft--; downloads++;
      return route.fulfill({ headers: cors, json: { text: '1\n00:00:00,000 --> 99:00:00,000\nBienvenidos a la casa\n', remaining: quotaLeft } });
    }
    return route.fulfill({ status: 404, headers: cors, json: {} });
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const results = [];
  const step = async (label, fn) => {
    try { await fn(); results.push(`PASS ${label}`); } catch (e) { results.push(`FAIL ${label} - ${e.message.split('\n')[0]}`); }
  };
  const openMenu = async () => { await p.mouse.move(200, 200); await p.locator('[aria-label="Subtitles"]').last().click(); };
  const playFirst = async () => { await p.click('[aria-label="Movies tab"]'); await p.waitForTimeout(1200); await p.getByRole('button', { name: /^(Play|Resume)$/ }).first().click(); await p.waitForTimeout(1200); };

  await p.goto(BASE);
  await step('profile', async () => { await p.waitForSelector("text=Who's watching?", { timeout: 60000 }); await p.click('text=Arkadi'); await p.waitForSelector('text=Watch live', { timeout: 60000 }); });
  await step('Spanish offers an OpenSubtitles search', async () => {
    await playFirst(); await openMenu();
    await p.click('[aria-label="Subtitles Spanish · Español"]');
    await p.locator('[aria-label="Subtitles Search Spanish on OpenSubtitles"]').waitFor({ timeout: 4000 });
    await p.getByText('Subtitles from OpenSubtitles.com').waitFor({ timeout: 2000 });
  });
  await step('search lists results, best first', async () => {
    await p.click('[aria-label="Subtitles Search Spanish on OpenSubtitles"]');
    await p.getByText('House.on.Haunted.Hill.1959.720p').waitFor({ timeout: 4000 });
    await p.getByText('900 downloads · for hearing impaired').waitFor({ timeout: 2000 });
  });
  await step('choosing one shows it on screen', async () => {
    await p.click('[aria-label="Subtitles House.on.Haunted.Hill.1959.720p"]');
    await p.waitForSelector('text=Bienvenidos a la casa', { timeout: 6000 });
    if (downloads !== 1) throw new Error(`downloads ${downloads}`);
  });
  await step('reopening the film uses the saved file (no new download)', async () => {
    await p.click('[aria-label="Back"]'); await p.waitForTimeout(400);
    await p.getByRole('button', { name: /^(Play|Resume)$/ }).first().click(); await p.waitForTimeout(1500);
    await p.waitForSelector('text=Bienvenidos a la casa', { timeout: 6000 });
    if (downloads !== 1) throw new Error(`downloads ${downloads}`);
  });
  await step('Off turns it off', async () => {
    await openMenu(); await p.click('[aria-label="Subtitles Off"]'); await p.waitForTimeout(300);
    if (await p.locator('text=Bienvenidos a la casa').count()) throw new Error('still showing');
  });
  await step('daily limit is explained', async () => {
    await openMenu(); await p.click('[aria-label="Subtitles Hebrew · עברית"]');
    await p.click('[aria-label="Subtitles Search Hebrew on OpenSubtitles"]');
    await p.click('[aria-label="Subtitles House.on.Haunted.Hill.1959.720p"]');
    await p.getByText(/free subtitle downloads are used up/).waitFor({ timeout: 4000 });
  });
  await step('nothing found is explained', async () => {
    await p.click('[aria-label="Subtitles Russian · Русский"]');
    await p.click('[aria-label="Subtitles Search Russian on OpenSubtitles"]');
    await p.getByText('No Russian subtitles found on OpenSubtitles for this title.').waitFor({ timeout: 4000 });
  });
  await step('no page errors', async () => { if (errs.length) throw new Error(errs.join(' | ')); });
  console.log(results.join('\n'));
  await b.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
