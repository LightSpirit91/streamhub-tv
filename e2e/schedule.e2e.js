/**
 * Week schedule: every channel has "Full schedule" (Live TV and the player).
 * Big screens show a week grid, phones one day at a time; reminders work;
 * Escape closes it. The week guide files are simulated (7 days, hourly shows).
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:8776/streamhub-tv/';

function weekBucket(id) {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) >>> 0;
  return h % 64;
}

async function run(b, name, viewport) {
  const ctx = await b.newContext({ viewport });
  let ids = [];
  await ctx.route(/catalog\/catalog\.json/, async (route) => {
    const res = await route.fetch();
    const j = await res.json();
    ids = j.channels.map((c) => c.id);
    await route.fulfill({ response: res, json: j });
  });
  await ctx.route(/catalog\/epg-week\/(\d+)\.json/, async (route) => {
    const n = Number(/epg-week\/(\d+)\.json/.exec(route.request().url())[1]);
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const start = Math.floor(d.getTime() / 1000);
    const list = [];
    for (let t = start; t < start + 7 * 86400; t += 3600) list.push([t, t + 3600, `Show at ${new Date(t * 1000).toISOString().slice(5, 13)}`, 'A test programme.', 'News']);
    const programs = {};
    for (const id of ids) if (weekBucket(id) === n) programs[id] = list;
    await route.fulfill({ json: { version: 1, builtAt: Date.now(), programs } });
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const results = [];
  const step = async (label, fn) => {
    try { await fn(); results.push(`PASS ${name} · ${label}`); } catch (e) { results.push(`FAIL ${name} · ${label} - ${e.message.split('\n')[0]}`); }
  };
  await p.goto(BASE);
  await step('profile', async () => { await p.waitForSelector("text=Who's watching?", { timeout: 60000 }); await p.click('text=Arkadi'); await p.waitForSelector('text=Watch live', { timeout: 60000 }); });
  await step('Live TV: Full schedule opens the week', async () => {
    await p.click('[aria-label="Live TV tab"]'); await p.waitForSelector('text=channels', { timeout: 10000 });
    await p.getByRole('button', { name: 'Full schedule' }).first().click();
    await p.waitForSelector('text=Tomorrow', { timeout: 10000 });
    await p.waitForSelector('text=Schedule through', { timeout: 5000 });
  });
  if (viewport.width > 900) {
    await step('grid has a column per day (7)', async () => {
      const heads = await p.locator('text=/^(Today|Tomorrow|[A-Z][a-z]{2}, [A-Z][a-z]{2} \\d+)$/').count();
      if (heads < 7) throw new Error(`only ${heads} day columns`);
    });
  } else {
    await step('phone: pick a day', async () => {
      await p.getByRole('button', { name: 'Tomorrow' }).click(); await p.waitForTimeout(300);
      await p.waitForSelector('text=Show at', { timeout: 3000 });
    });
  }
  await step('remind me on a future show', async () => {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(20, 0, 0, 0);
    const label = `Show at ${tomorrow.toISOString().slice(5, 13)}`;
    await p.getByText(label, { exact: true }).first().click();
    await p.getByRole('button', { name: 'Remind me' }).click();
    await p.getByRole('button', { name: 'Reminder set' }).waitFor({ timeout: 3000 });
  });
  await step('Escape closes, Live TV keys work again', async () => {
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    if (await p.locator('text=Schedule through').count()) throw new Error('still open');
  });
  await step('player: schedule button', async () => {
    await p.getByRole('button', { name: 'Watch fullscreen' }).first().click(); await p.waitForTimeout(1200);
    await p.mouse.move(300, 300);
    await p.locator('[aria-label="Full schedule"]').last().click();
    await p.waitForSelector('text=Tomorrow', { timeout: 10000 });
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await p.waitForSelector('[aria-label="Back"]', { timeout: 3000 }); // still in the player
    await p.click('[aria-label="Back"]');
  });
  await step('My List shows the reminder', async () => {
    await p.click('[aria-label="My List tab"]'); await p.waitForSelector('text=Show at', { timeout: 5000 });
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
