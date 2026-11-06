/**
 * Whole-app smoke test on desktop and phone sizes. Fails on any page error.
 * Same setup as cast.e2e.js (export the web build, serve it, run with node).
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:8776/streamhub-tv/';

async function run(b, name, viewport) {
  const ctx = await b.newContext({ viewport });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  p.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|ERR_|net::|CORS|status of 4\d\d|status of 5\d\d/.test(m.text())) errs.push(`console: ${m.text().slice(0, 200)}`);
  });
  const results = [];
  const step = async (label, fn) => {
    try { await fn(); results.push(`PASS ${name} · ${label}`); } catch (e) { results.push(`FAIL ${name} · ${label} - ${e.message.split('\n')[0]}`); }
  };
  const tab = (t) => p.click(`[aria-label="${t} tab"]`);
  await p.goto(BASE);
  await step('profile picker', async () => { await p.waitForSelector("text=Who's watching?", { timeout: 60000 }); await p.click('text=My Love'); });
  await step('home loads', async () => { await p.waitForSelector('text=Watch live', { timeout: 60000 }); });
  await step('live channel opens and closes', async () => {
    await p.click('text=Watch live'); await p.waitForTimeout(1500);
    await p.waitForSelector('[aria-label="Back"]'); await p.click('[aria-label="Back"]'); await p.waitForTimeout(500);
  });
  await step('save to My List from the player', async () => {
    await p.click('text=Watch live'); await p.waitForTimeout(800);
    await p.click('[aria-label="Add to My List"]'); await p.waitForSelector('[aria-label="Remove from My List"]', { timeout: 3000 });
    await p.click('[aria-label="Back"]');
  });
  await step('Live TV guide', async () => { await tab('Live TV'); await p.waitForSelector('text=channels', { timeout: 10000 }); });
  await step('Live TV filter chip', async () => { await p.getByText('Israel', { exact: true }).first().click(); await p.waitForTimeout(600); });
  await step('Movies page + details + close', async () => {
    await tab('Movies'); await p.waitForTimeout(1500);
    await p.getByText('Details', { exact: true }).first().click(); await p.waitForTimeout(600);
    await p.click('[aria-label="Close"] >> nth=-1');
  });
  await step('Movies genre grid', async () => { await p.getByText('Western', { exact: true }).first().click(); await p.waitForTimeout(800); });
  await step('Shows page + episodes sheet + play + back', async () => {
    await tab('Shows'); await p.waitForTimeout(1500);
    await p.getByText('Episodes', { exact: true }).first().click(); await p.waitForTimeout(600);
    await p.getByRole('button', { name: /^(Play|Resume)/ }).first().click(); await p.waitForTimeout(1200);
    await p.click('[aria-label="Back"]'); await p.waitForTimeout(400);
  });
  await step('My List shows the saved channel', async () => { await tab('My List'); await p.waitForSelector('text=Favorite Channels', { timeout: 5000 }); });
  await step('Search channels and movies', async () => { await tab('Search'); await p.fill('input', 'kan'); await p.waitForTimeout(800); await p.waitForSelector('text=channel', { timeout: 5000 }); });
  await step('switch profile keeps lists separate', async () => {
    await p.click('[aria-label="Switch profile"]'); await p.click('text=Arkadi'); await p.waitForSelector('text=Watch live', { timeout: 20000 });
    await tab('My List'); await p.waitForTimeout(500);
    if (await p.locator('text=Favorite Channels').count()) throw new Error("My Love's favorite leaked into Arkadi");
  });
  await ctx.close();
  return { results, errs };
}

(async () => {
  const b = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost' } } : {});
  let failed = 0;
  for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const { results, errs } = await run(b, name, vp);
    results.forEach((r) => console.log(r));
    errs.forEach((e) => console.log(`ERROR ${name} · ${e}`));
    failed += results.filter((r) => r.startsWith('FAIL')).length + errs.length;
  }
  await b.close();
  console.log(failed ? `\n${failed} problem(s)` : '\nAll clear');
  process.exit(failed ? 1 : 0);
})();
