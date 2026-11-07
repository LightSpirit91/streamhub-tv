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
  await step('Live TV preview: small controls, one sound in fullscreen', async () => {
    await p.locator('[aria-label="Pause preview"]').first().waitFor({ timeout: 8000 });
    await p.locator('[aria-label="Pause preview"]').first().click();
    await p.locator('[aria-label="Play preview"]').first().waitFor({ timeout: 3000 });
    await p.locator('[aria-label="Play preview"]').first().click();
    await p.getByRole('button', { name: 'Watch fullscreen' }).first().click(); await p.waitForTimeout(1200);
    const videos = await p.locator('video').count();
    if (videos !== 1) throw new Error(`${videos} videos playing at once`);
    await p.click('[aria-label="Back"]'); await p.waitForTimeout(600);
    await p.locator('[aria-label="Pause preview"], [aria-label="Play preview"]').first().waitFor({ timeout: 5000 }).catch(async () => {
      if (!(await p.getByText('Channel offline').count())) throw new Error('preview did not come back');
    });
  });
  await step('Live TV country picker', async () => {
    const chip = p.locator('[aria-label^="Country Russia"]').first();
    const label = await chip.getAttribute('aria-label');
    const want = Number(label.replace(/\D/g, ''));
    await chip.click(); await p.waitForTimeout(500);
    const head = await p.getByText(/^[\d,]+ channels/).first().innerText();
    const got = Number(head.split(' ')[0].replace(/,/g, ''));
    if (got !== want) throw new Error(`picked Russia (${want}) but list shows ${got}`);
    await p.locator('[aria-label="Country All countries"]').click(); await p.waitForTimeout(300);
  });
  await step('Live TV sources panel: switch a source off and on', async () => {
    const count = async () => Number((await p.getByText(/^[\d,]+ channels/).first().innerText()).split(' ')[0].replace(/,/g, ''));
    const before = await count();
    await p.click('[aria-label="Channel sources"]');
    await p.locator('[aria-label="Source iptv-org on"]').click(); await p.waitForTimeout(500);
    await p.locator('[aria-label="Source iptv-org off"]').waitFor({ timeout: 3000 });
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    const off = await count();
    if (!(off < before)) throw new Error(`count did not drop (${before} -> ${off})`);
    await p.click('[aria-label="Channel sources"]');
    await p.locator('[aria-label="Source iptv-org off"]').click(); await p.waitForTimeout(500);
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    // The preview marks dead links while the test runs, so allow a small drift.
    const back = await count();
    if (Math.abs(back - before) > Math.max(20, before * 0.02)) throw new Error(`count did not come back (${before} -> ${back})`);
  });
  await step('Live TV filter chip', async () => { await p.getByText('Israel', { exact: true }).first().click(); await p.waitForTimeout(600); });
  await step('Movies page + details + close', async () => {
    await tab('Movies'); await p.waitForTimeout(1500);
    await p.getByText('Details', { exact: true }).first().click(); await p.waitForTimeout(600);
    await p.click('[aria-label="Close"] >> nth=-1');
  });
  await step('Movies genre grid', async () => { await p.getByText('Western', { exact: true }).first().click(); await p.waitForTimeout(800); });
  await step('Shows page + episodes sheet + play + back', async () => {
    await tab('Shows'); await p.waitForTimeout(1500);
    // The hero is either a series that plays here (Episodes) or one that streams free elsewhere (Details).
    await p.getByRole('button', { name: /^(Episodes|Details)$/ }).first().click(); await p.waitForTimeout(600);
    const play = p.getByRole('button', { name: /^(Play episode|Resume episode)/ });
    if (await play.count()) {
      await play.first().click(); await p.waitForTimeout(1200);
      await p.click('[aria-label="Back"]'); await p.waitForTimeout(400);
    } else {
      await p.getByRole('button', { name: /^Watch free on / }).first().waitFor({ timeout: 3000 });
      await p.click('[aria-label="Close"] >> nth=-1'); await p.waitForTimeout(300);
    }
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
