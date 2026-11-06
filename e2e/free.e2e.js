/**
 * Newest free-to-stream titles: Movies and Shows lead with them, cards carry
 * the service name, the page has "Watch free on <service>" and the link opens
 * that service. Uses the live library plus two injected titles.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:8776/streamhub-tv/';
const today = new Date().toISOString().slice(0, 10);
const tubi = (t) => [{ name: 'Tubi TV', type: 'ads', url: `https://tubitv.com/search/${encodeURIComponent(t)}` }];
const MOVIE = {
  id: 'tmdb:movie:999001', title: 'Zz Test New Release', year: Number(today.slice(0, 4)), releaseDate: today, genres: ['Drama'],
  description: 'A brand new film.', poster: 'https://image.tmdb.org/t/p/w500/x.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/x.jpg',
  url: '', source: 'free', popularity: 9e9, freeOn: tubi('Zz Test New Release'), tmdbId: 999001, tmdbType: 'movie',
};
const SHOW = {
  id: 'tmdb:tv:999002', title: 'Zz Test New Series', year: 2025, releaseDate: today, seasons: 2, genres: ['Drama'], description: 'New episodes.',
  poster: 'https://image.tmdb.org/t/p/w500/y.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/y.jpg', source: 'free', popularity: 9e9,
  freeOn: tubi('Zz Test New Series'), episodes: [], tmdbId: 999002, tmdbType: 'tv',
};

(async () => {
  const b = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost' } } : {});
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/catalog\/(movies|shows)\.json/, async (route) => {
    const res = await route.fetch();
    const j = await res.json();
    if (j.movies) j.movies.unshift(MOVIE);
    if (j.shows) j.shows.unshift(SHOW);
    await route.fulfill({ response: res, json: j });
  });
  // Stand-in for the real service, so the test never depends on reaching it.
  await ctx.route(/tubitv\.com/, (r) => r.fulfill({ contentType: 'text/html', body: '<p>Tubi</p>' }));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const results = [];
  const step = async (label, fn) => {
    try { await fn(); results.push(`PASS ${label}`); } catch (e) { results.push(`FAIL ${label} - ${e.message.split('\n')[0]}`); }
  };
  await p.goto(BASE);
  await step('profile', async () => { await p.waitForSelector("text=Who's watching?", { timeout: 60000 }); await p.click('text=Arkadi'); await p.waitForSelector('text=Watch live', { timeout: 60000 }); });
  await step('Movies hero leads with the new release', async () => {
    await p.click('[aria-label="Movies tab"]');
    await p.waitForSelector('text=NEW RELEASE', { timeout: 15000 });
    await p.getByRole('button', { name: 'Watch free on Tubi TV' }).first().waitFor({ timeout: 5000 });
  });
  await step('New Releases row, newest first, card shows the service', async () => {
    await p.waitForSelector('text=New Releases');
    await p.getByText('Tubi TV', { exact: true }).first().waitFor({ timeout: 5000 });
  });
  await step('Play on a free title opens its page with the service button', async () => {
    await p.getByRole('button', { name: 'Watch free on Tubi TV' }).first().click();
    await p.waitForSelector('text=Zz Test New Release', { timeout: 5000 });
    await p.waitForSelector('text=opens on Tubi TV', { timeout: 5000 });
  });
  await step('the button opens Tubi', async () => {
    const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 8000 }), p.getByRole('button', { name: 'Watch free on Tubi TV' }).last().click()]);
    const url = popup.url();
    await popup.close();
    if (!url.startsWith('https://tubitv.com/search/Zz%20Test%20New%20Release')) throw new Error(`opened ${url}`);
    await p.click('[aria-label="Close"] >> nth=-1');
  });
  await step('Shows lead with the newest series', async () => {
    await p.click('[aria-label="Shows tab"]');
    await p.waitForSelector('text=NEW EPISODES', { timeout: 15000 });
    await p.waitForSelector('text=Newest Episodes & Series');
    await p.getByRole('button', { name: 'Details' }).first().click();
    await p.waitForSelector('text=2 seasons', { timeout: 5000 });
    await p.getByRole('button', { name: 'Watch free on Tubi TV' }).last().waitFor({ timeout: 5000 });
    await p.click('[aria-label="Close"] >> nth=-1');
  });
  await step('no page errors', async () => { if (errs.length) throw new Error(errs.join(' | ')); });
  console.log(results.join('\n'));
  await b.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
