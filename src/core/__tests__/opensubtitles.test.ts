import { describe, expect, it } from 'vitest';
import { OpenSubtitles, OsError, imdbNum, searchPath, toResults } from '../../../worker/subtitles/src/opensubtitles';
import worker, { errorBody } from '../../../worker/subtitles/src/index';

const CREDS = { apiKey: 'KEY-SECRET', username: 'USER-SECRET', password: 'PASS-SECRET' };
type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

/** Fake OpenSubtitles: records calls, answers from a script. */
function fake(script: (c: Call, n: number) => { status: number; body?: unknown; text?: string }) {
  const calls: Call[] = [];
  const f = async (url: string, init: RequestInit = {}) => {
    const c = { url, method: init.method ?? 'GET', headers: (init.headers ?? {}) as Record<string, string>, body: init.body as string | undefined };
    calls.push(c);
    const r = script(c, calls.length);
    return new Response(r.text ?? JSON.stringify(r.body ?? {}), { status: r.status });
  };
  return { f: f as typeof fetch, calls };
}

const hit = (lang: string, id: number, dl: number, extra: Record<string, unknown> = {}) => ({
  attributes: { language: lang, release: `Rel ${id}`, download_count: dl, files: [{ file_id: id }], ...extra },
});

describe('OpenSubtitles API rules', () => {
  it('builds search URLs lowercase, alphabetical, without tt and leading zeros', () => {
    expect(imdbNum('tt0051744')).toBe('51744');
    expect(searchPath({ imdbId: 'tt0051744', lang: 'es' })).toBe('/subtitles?ai_translated=exclude&imdb_id=51744&languages=es&machine_translated=exclude&order_by=download_count');
    expect(searchPath({ imdbId: 'tt0052520', lang: 'he', season: 1, episode: 3 })).toBe(
      '/subtitles?ai_translated=exclude&episode_number=3&languages=he&machine_translated=exclude&order_by=download_count&parent_imdb_id=52520&season_number=1',
    );
  });

  it('keeps human-made files in the asked language, best first', () => {
    const r = toResults([hit('es', 1, 50, { hearing_impaired: true }), hit('es', 2, 10), hit('en', 3, 900), hit('es', 4, 99, { ai_translated: true }), hit('es', 5, 30)], 'es');
    expect(r.map((x) => x.fileId)).toEqual([5, 2, 1]);
  });
});

describe('OpenSubtitles client', () => {
  it('logs in once, uses base_url, sends Api-Key and a named User-Agent', async () => {
    const { f, calls } = fake((c) =>
      c.url.endsWith('/login') ? { status: 200, body: { token: 'T1', base_url: 'vip-api.example.com', user: { remaining_downloads: 20 } } } : { status: 200, body: { data: [hit('ru', 7, 3)] } },
    );
    const os = new OpenSubtitles(CREDS, f);
    await os.search({ imdbId: 'tt1', lang: 'ru' });
    await os.search({ imdbId: 'tt2', lang: 'ru' });
    expect(calls.filter((c) => c.url.endsWith('/login'))).toHaveLength(1);
    expect(calls[1].url.startsWith('https://vip-api.example.com/api/v1/subtitles?')).toBe(true);
    expect(calls[1].headers['Api-Key']).toBe('KEY-SECRET');
    expect(calls[1].headers['User-Agent']).toBe('StreamHub v1.0');
    expect(calls[1].headers.Authorization).toBe('Bearer T1');
    expect(os.quota.remaining).toBe(20);
  });

  it('renews an expired token once on 401', async () => {
    let logins = 0;
    const { f, calls } = fake((c) => {
      if (c.url.endsWith('/login')) return { status: 200, body: { token: `T${++logins}` } };
      return c.headers.Authorization === 'Bearer T1' ? { status: 401 } : { status: 200, body: { data: [] } };
    });
    const os = new OpenSubtitles(CREDS, f);
    expect(await os.search({ imdbId: '5', lang: 'en' })).toEqual([]);
    expect(logins).toBe(2);
    expect(calls.at(-1)!.headers.Authorization).toBe('Bearer T2');
  });

  it('stops after a refused login and waits before trying again (account lockout)', async () => {
    let t = 0;
    const { f, calls } = fake(() => ({ status: 401, body: { message: 'invalid username/password' } }));
    const os = new OpenSubtitles(CREDS, f, () => t);
    await expect(os.search({ imdbId: '5', lang: 'en' })).rejects.toMatchObject({ info: { kind: 'auth' } });
    await expect(os.search({ imdbId: '5', lang: 'en' })).rejects.toMatchObject({ info: { kind: 'auth' } });
    expect(calls).toHaveLength(1); // second attempt never reached OpenSubtitles
    t = OpenSubtitles.AUTH_COOLDOWN_MS + 1;
    await expect(os.search({ imdbId: '5', lang: 'en' })).rejects.toBeInstanceOf(OsError);
    expect(calls).toHaveLength(2);
  });

  it('downloads, tracks the daily allowance, and reports when it is used up', async () => {
    let remaining = 1;
    const { f } = fake((c) => {
      if (c.url.endsWith('/login')) return { status: 200, body: { token: 'T' } };
      if (c.url.endsWith('/download')) {
        if (remaining <= 0) return { status: 406, body: { message: 'You have downloaded your allowed 20 subtitles for 24h', reset_time_utc: '2026-11-08T00:00:00Z' } };
        remaining--;
        return { status: 200, body: { link: 'https://dl.example/file.srt', remaining, reset_time_utc: '2026-11-08T00:00:00Z' } };
      }
      return { status: 200, text: '1\n00:00:01,000 --> 00:00:02,000\nHola\n' };
    });
    const os = new OpenSubtitles(CREDS, f);
    const r = await os.download(42);
    expect(r.text).toContain('Hola');
    expect(r.remaining).toBe(0);
    await expect(os.download(43)).rejects.toMatchObject({ info: { kind: 'quota', resetTime: '2026-11-08T00:00:00Z' } });
  });
});

describe('subtitle backend (worker)', () => {
  const env = { OS_API_KEY: 'KEY-SECRET', OS_USERNAME: 'USER-SECRET', OS_PASSWORD: 'PASS-SECRET', ALLOWED_ORIGINS: 'https://lightspirit91.github.io' };
  it('refuses other websites and bad input, and never returns credentials', async () => {
    const other = await worker.fetch(new Request('https://w/search?imdb=tt1&lang=es', { headers: { Origin: 'https://evil.example' } }), env);
    expect(other.status).toBe(403);
    const bad = await worker.fetch(new Request('https://w/search?imdb=x&lang=fr', { headers: { Origin: 'https://lightspirit91.github.io' } }), env);
    expect(bad.status).toBe(400);
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBe('https://lightspirit91.github.io');
    const pre = await worker.fetch(new Request('https://w/search', { method: 'OPTIONS', headers: { Origin: 'https://lightspirit91.github.io' } }), env);
    expect(pre.status).toBe(204);
    for (const r of [other, bad]) {
      const t = await r.text();
      expect(t).not.toMatch(/SECRET/);
    }
  });
});

describe('subtitle backend on Cloudflare (fixes the 500)', () => {
  it('works with a fetch that refuses method calls ("Illegal invocation"), like Cloudflare Workers', async () => {
    const real = globalThis.fetch;
    const strict = function (this: unknown, url: string) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      const u = String(url);
      if (u.endsWith('/login')) return Promise.resolve(new Response(JSON.stringify({ token: 'T' })));
      return Promise.resolve(new Response(JSON.stringify({ data: [hit('es', 9, 1)] })));
    };
    globalThis.fetch = strict as typeof fetch;
    try {
      const os = new OpenSubtitles(CREDS); // default fetcher, as in the Worker
      expect((await os.search({ imdbId: 'tt0051744', lang: 'es' })).map((r) => r.fileId)).toEqual([9]);
    } finally {
      globalThis.fetch = real;
    }
  });

  it('turns network errors, non-JSON replies and odd shapes into labelled errors', async () => {
    const down = new OpenSubtitles(CREDS, async () => { throw new TypeError('network down'); });
    await expect(down.search({ imdbId: '5', lang: 'en' })).rejects.toMatchObject({ info: { kind: 'upstream', stage: 'login-network' } });
    const html = new OpenSubtitles(CREDS, async () => new Response('<html>maintenance</html>', { status: 200 }));
    await expect(html.search({ imdbId: '5', lang: 'en' })).rejects.toMatchObject({ info: { stage: 'login-json' } });
    const { f } = fake((c) => (c.url.endsWith('/login') ? { status: 200, body: { token: 'T' } } : { status: 200, body: { data: { not: 'a list' } } }));
    await expect(new OpenSubtitles(CREDS, f).search({ imdbId: '5', lang: 'en' })).rejects.toMatchObject({ info: { stage: 'search-shape' } });
    const { f: f2 } = fake((c) => (c.url.endsWith('/login') ? { status: 200, body: { token: 'T' } } : { status: 200, body: { data: [null, { attributes: { language: 'en', files: 'x' } }, hit('en', 4, 2)] } }));
    expect((await new OpenSubtitles(CREDS, f2).search({ imdbId: '5', lang: 'en' })).map((r) => r.fileId)).toEqual([4]);
  });

  it('error answers carry only safe labels', () => {
    const [b, status, label] = errorBody(new TypeError('Illegal invocation: KEY-SECRET Bearer T1'));
    expect(status).toBe(500);
    expect(label).toBe('exception-TypeError');
    expect(JSON.stringify(b)).not.toMatch(/SECRET|Bearer|Illegal/);
    expect(errorBody(new OsError({ kind: 'upstream', status: 502, stage: 'search-json' }))).toEqual([{ error: 'unavailable', code: 'search-json-502' }, 502, 'search-json-502']);
  });
});
