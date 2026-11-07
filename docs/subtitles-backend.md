# Subtitle backend (OpenSubtitles)

StreamHub is a static site, so it cannot hold the OpenSubtitles API key,
username or password: anything shipped to the browser or the Fire TV / iPhone
app can be read by anyone. The OpenSubtitles credentials therefore live in a
tiny backend, `worker/subtitles`, made for the Cloudflare Workers free plan.

## What it does
- `GET /search?imdb=tt0051744&lang=es` (and `&season=1&episode=2` for episodes):
  best human-made subtitles for that title and language (AI / machine
  translations excluded).
- `POST /download {"fileId": 123}`: fetches the chosen file (uses one of the
  account's free daily downloads) and returns its text.
- Logs in once, reuses the token about a day, renews it when it expires.
- After a refused login it waits 30 minutes before trying again
  (OpenSubtitles locks accounts after about 10 failed logins).
- Daily allowance used up -> the app says when it resets. Nothing found,
  busy, or unavailable -> the app says so; playback is never blocked.
- Answers only https://lightspirit91.github.io (and localhost for testing).
- Never logs or returns the key, username, password or token.

The app keeps every subtitle you open on your device, so watching the same
title again does not use another download. Nothing is published publicly.

## Deploy (free, about 10 minutes, needs approval first)
1. Free Cloudflare account (no card, Workers free plan: 100,000 requests a day).
2. From `worker/subtitles`:
   `npx wrangler login`, then
   `npx wrangler secret put OS_API_KEY`, `... OS_USERNAME`, `... OS_PASSWORD`
   (typed into the terminal prompt, never into files or chat), then
   `npx wrangler deploy`. It prints the address, e.g.
   `https://streamhub-subtitles.<account>.workers.dev`.
3. GitHub repo -> Settings -> Secrets and variables -> Actions -> Variables ->
   `SUBTITLES_API_URL` = that address (a variable, not a secret: it is public).
4. Next web app update shows "Search ... on OpenSubtitles" in the player.

Attribution: the player shows "Subtitles from OpenSubtitles.com" wherever
OpenSubtitles results are listed.
