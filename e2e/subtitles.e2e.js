/**
 * Subtitles: the player's Subtitles menu offers English, Español, Русский and
 * עברית; a subtitle file shows on screen; the choice is remembered for the
 * next title; live channels have the menu too. Subtitle files are simulated.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:8776/streamhub-tv/';

async function run(b, name, viewport) {
  const ctx = await b.newContext({ viewport });
  await ctx.route(/catalog\/movies\.json/, async (route) => {
    const res = await route.fetch();
    const j = await res.json();
    j.movies = j.movies.filter((m) => m.source === 'archive').slice(0, 60)
      .map((m) => ({ ...m, subs: [{ lang: 'es', url: 'https://subs.test/es.vtt' }, { lang: 'he', url: 'https://subs.test/he.srt' }] }));
    await route.fulfill({ response: res, json: j });
  });
  await ctx.route('https://subs.test/es.vtt', (r) => r.fulfill({ contentType: 'text/vtt', body: 'WEBVTT\n\n00:00.000 --> 99:00:00.000\nHola amigos\n' }));
  await ctx.route('https://subs.test/he.srt', (r) => r.fulfill({ contentType: 'text/plain', body: '1\n00:00:00,000 --> 99:00:00,000\nשלום חברים\n' }));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const results = [];
  const step = async (label, fn) => {
    try { await fn(); results.push(`PASS ${name} · ${label}`); } catch (e) { results.push(`FAIL ${name} · ${label} - ${e.message.split('\n')[0]}`); }
  };
  const openSubs = async () => { await p.mouse.move(200, 200); await p.locator('[aria-label="Subtitles"]').last().click(); await p.waitForSelector('text=Not available for this title, text=Subtitle file', { timeout: 5000 }).catch(() => {}); };
  await p.goto(BASE);
  await step('profile', async () => { await p.waitForSelector("text=Who's watching?", { timeout: 60000 }); await p.click('text=Arkadi'); await p.waitForSelector('text=Watch live', { timeout: 60000 }); });
  await step('movie: menu lists the four languages', async () => {
    await p.click('[aria-label="Movies tab"]'); await p.waitForTimeout(1500);
    await p.getByRole('button', { name: /^(Play|Resume)$/ }).first().click(); await p.waitForTimeout(1200);
    await openSubs();
    for (const l of ['Subtitles Off', 'Subtitles English', 'Subtitles Spanish · Español', 'Subtitles Russian · Русский', 'Subtitles Hebrew · עברית']) {
      await p.locator(`[aria-label="${l}"]`).waitFor({ timeout: 3000 });
    }
    await p.getByText('Subtitle file').first().waitFor({ timeout: 3000 });
  });
  await step('Spanish subtitle file shows on screen', async () => {
    await p.click('[aria-label="Subtitles Spanish · Español"]');
    await p.waitForSelector('text=Hola amigos', { timeout: 8000 });
  });
  await step('Hebrew (right to left) works', async () => {
    await openSubs(); await p.click('[aria-label="Subtitles Hebrew · עברית"]');
    await p.waitForSelector('text=שלום חברים', { timeout: 8000 });
  });
  await step('choice is remembered for the next title', async () => {
    await p.click('[aria-label="Back"]'); await p.waitForTimeout(500);
    await p.getByRole('button', { name: /^(Play|Resume)$/ }).first().click(); await p.waitForTimeout(1200);
    await p.waitForSelector('text=שלום חברים', { timeout: 8000 });
  });
  await step('Off hides them', async () => {
    await openSubs(); await p.click('[aria-label="Subtitles Off"]'); await p.waitForTimeout(400);
    if (await p.locator('text=שלום חברים').count()) throw new Error('still showing');
    await p.click('[aria-label="Back"]');
  });
  await step('live channel has the menu too', async () => {
    await p.click('[aria-label="Home tab"]'); await p.waitForTimeout(500);
    await p.click('text=Watch live'); await p.waitForTimeout(1500);
    await openSubs();
    await p.locator('[aria-label="Subtitles English"]').waitFor({ timeout: 3000 });
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await p.waitForSelector('[aria-label="Back"]', { timeout: 3000 }); // menu closed, player still open
    await p.click('[aria-label="Back"]');
  });
  await step('no page errors', async () => { if (errs.length) throw new Error(errs.join(' | ')); });
  await ctx.close();
  return results;
}

(async () => {
  const b = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost' } } : {});
  const r = [...(await run(b, 'desktop', { width: 1440, height: 900 })), ...(await run(b, 'phone', { width: 390, height: 844 }))];
  console.log(r.join('\n'));
  await b.close();
  process.exit(r.some((x) => x.startsWith('FAIL')) ? 1 : 0);
})();
