/**
 * Player layout: no button or text overlaps another, on phone (portrait and
 * landscape), tablet, laptop and desktop sizes, for live TV, a movie and an
 * episode. Measures every visible button and line of text on screen.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:8776/streamhub-tv/';
const SIZES = [[375, 667], [390, 844], [430, 932], [844, 390], [768, 1024], [1024, 768], [1280, 800], [1440, 900]];

async function overlaps(p, edges = true) {
  return p.evaluate((edges) => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.opacity !== '0' && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    };
    const buttons = [...document.querySelectorAll('[role="button"]')].filter(vis);
    // Leaf lines of text that are not inside a button.
    const texts = [...document.querySelectorAll('div[dir], span[dir]')].filter((el) => el.childElementCount === 0 && el.textContent.trim() && vis(el) && !el.closest('[role="button"]'));
    // Only what you can actually see: the element (or its content) is on top at its own centre.
    const onTop = (el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
      return !!hit && (el === hit || el.contains(hit));
    };
    const items = [...buttons, ...texts].filter(onTop).map((el) => {
      const r = el.getBoundingClientRect();
      // Text boxes: measure the glyphs, not the stretched block.
      let box = r;
      if (!el.matches('[role="button"]')) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const g = range.getBoundingClientRect();
        // Truncated text ("...") is clipped to its own box: measure the visible part.
        const left = Math.max(g.left, r.left), right = Math.min(g.right, r.right);
        const top = Math.max(g.top, r.top), bottom = Math.min(g.bottom, r.bottom);
        box = { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
      }
      // Clip to every scrolling / clipping ancestor: content scrolled out of view isn't visible.
      let { left, top } = box;
      let right = box.left + box.width, bottom = box.top + box.height;
      for (let a = el.parentElement; a; a = a.parentElement) {
        const st = getComputedStyle(a);
        if (st.overflowX === 'visible' && st.overflowY === 'visible') continue;
        const c = a.getBoundingClientRect();
        left = Math.max(left, c.left); top = Math.max(top, c.top); right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom);
      }
      return { el, x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top), name: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30) };
    });
    const bad = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      // Page content scrolling underneath the solid navigation bar is not an overlap.
      const navA = !!a.el.closest('[role="tab"]'), navB = !!b.el.closest('[role="tab"]');
      if (navA !== navB) continue;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 2 && oy > 2) bad.push(`"${a.name}" x "${b.name}"`);
    }
    // Anything sticking out of the screen sideways.
    // Sideways overflow (players only; rows of cards scroll sideways on purpose).
    if (edges) for (const it of items) if (it.x < -1 || it.x + it.w > innerWidth + 1) bad.push(`"${it.name}" off screen`);
    return bad;
  }, edges);
}

(async () => {
  const b = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost' } } : {});
  const results = [];
  for (const [w, h] of SIZES) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    await ctx.route(/catalog\/(movies|shows)\.json/, async (route) => {
      const res = await route.fetch();
      const j = await res.json();
      if (j.movies) j.movies = j.movies.filter((m) => m.source === 'archive');
      if (j.shows) j.shows = j.shows.filter((x) => x.source === 'archive');
      await route.fulfill({ response: res, json: j });
    });
    const p = await ctx.newPage();
    const check = async (label, open) => {
      try {
        await open();
        await p.waitForTimeout(1500);
        await p.mouse.move(w / 2, h / 2); // show the controls
        await p.waitForTimeout(300);
        const bad = await overlaps(p);
        results.push(bad.length ? `FAIL ${w}x${h} ${label}: ${bad.slice(0, 6).join(', ')}` : `PASS ${w}x${h} ${label}`);
      } catch (e) {
        results.push(`FAIL ${w}x${h} ${label}: ${e.message.split('\n')[0]}`);
      }
    };
    await p.goto(BASE);
    await p.waitForSelector("text=Who's watching?", { timeout: 60000 }); await p.click('text=Arkadi'); await p.waitForSelector('text=Watch live', { timeout: 60000 });
    const screen = async (label, open) => {
      try {
        await open();
        await p.waitForTimeout(1200);
        const bad = await overlaps(p, false);
        results.push(bad.length ? `FAIL ${w}x${h} ${label}: ${bad.slice(0, 6).join(', ')}` : `PASS ${w}x${h} ${label}`);
      } catch (e) {
        results.push(`FAIL ${w}x${h} ${label}: ${e.message.split('\n')[0]}`);
      }
    };
    const tab = (t) => p.click(`[aria-label="${t} tab"]`);
    await screen('home', async () => {});
    await screen('live tv', async () => { await tab('Live TV'); await p.waitForSelector('text=channels', { timeout: 10000 }); });
    await screen('week schedule', async () => { await p.getByRole('button', { name: 'Full schedule' }).first().click(); await p.waitForTimeout(1500); });
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await screen('movies', async () => { await tab('Movies'); });
    await screen('movie details', async () => { await p.getByRole('button', { name: 'Details', exact: true }).first().click(); });
    await p.locator('[aria-label="Close"]').last().click().catch(() => {}); await p.waitForTimeout(300);
    await screen('shows', async () => { await tab('Shows'); });
    await screen('show details', async () => { await p.getByRole('button', { name: /^(Episodes|Details)$/ }).first().click(); });
    await p.locator('[aria-label="Close"]').last().click().catch(() => {}); await p.waitForTimeout(300);
    await screen('my list', async () => { await tab('My List'); });
    await screen('search', async () => { await tab('Search'); await p.fill('input', 'news'); await p.waitForTimeout(800); });
    await screen('profiles', async () => { await p.click('[aria-label="Switch profile"]'); await p.waitForSelector("text=Who's watching?"); });
    await p.click('text=Arkadi'); await p.waitForSelector('text=Watch live', { timeout: 20000 });
    await check('live player', async () => { await p.click('text=Watch live'); });
    await check('live subtitles menu', async () => { await p.locator('[aria-label="Subtitles"]').last().click(); });
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    await p.click('[aria-label="Back"]'); await p.waitForTimeout(400);
    await check('movie player', async () => {
      await p.click('[aria-label="Movies tab"]'); await p.waitForTimeout(1500);
      await p.getByRole('button', { name: /^(Play|Resume)$/ }).first().click();
    });
    await p.click('[aria-label="Back"]'); await p.waitForTimeout(400);
    await check('episode player', async () => {
      await p.click('[aria-label="Shows tab"]'); await p.waitForTimeout(1500);
      await p.getByRole('button', { name: 'Play', exact: true }).first().click();
    });
    await ctx.close();
  }
  console.log(results.join('\n'));
  await b.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
