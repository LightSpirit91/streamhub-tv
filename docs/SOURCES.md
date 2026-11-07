# StreamHub sources: research and decisions

Checked 2026-11-07 by reading each repository at its latest commit. "Personal
use" does not grant broadcast rights, so each source was judged on whether
the streams are published by, or with permission of, the people who own them.
Nothing here bypasses paywalls, DRM, sign-in, or geographic limits.

## In use (switchable in Live TV → Sources)

| Source | What it supplies | Upstream | Maintained | License | Notes for Canada |
|---|---|---|---|---|---|
| **iptv-org/iptv** | Live channel playlists by country, category, language | Community submissions of streams "made publicly by the copyright holders" (its Legal section); copyright claims are removed | Daily (last commit 2026-11-07) | Unlicense (public domain) | Some channels are geo-blocked outside their country; labelled in the playlists. StreamHub applies iptv-org's **blocklist** (copyright claims, adult) and drops channels its database marks **closed**. |
| **Free-TV/IPTV** | Hand-curated playlist of mainstream channels | Only channels "officially provided for free" (over the air); one URL per channel | Active (2026-11-07) | No license file; README rules | Geo-blocked channels are marked Ⓖ. Its YouTube entries are filtered out (your request). |
| **famelack/famelack-channels** | Public channels by country, uptime-checked | Aggregated public lists | Active | Public list | YouTube entries filtered out. |
| **iptv-org/database** | Channel names, other names, logos, network, closed dates | Community | Daily | Unlicense | Used for logos, descriptions, guide matching and the closed-channel cleanup. |
| **iptv-org/api** | JSON views of the same data (channels, feeds, streams, guides, blocklist) | iptv-org | Active | Unlicense | Used for the **blocklist**. Streams/channels duplicate the playlists and database already used. |
| **iptv-org/epg** | Tools that collect TV schedules from broadcasters' guide sites | Each guide site | Active | Unlicense | Used by the nightly **TV Guide Plus** job, isolated: read-only job, pinned commit, install scripts off. |

Every link is tested nightly; dead links are removed and remembered (graveyard),
and the player fails over between a channel's links. Streams whose server
doesn't allow other websites (no CORS) are ranked last in Chrome/Edge/Firefox;
Safari, the iPhone app and the Fire TV app play them.

New sources are also found by the daily discovery (manual until approved): see [DISCOVERY.md](DISCOVERY.md).

## Research only: not integrated

| Repository | What it actually is | Why it stays off | What would change that |
|---|---|---|---|
| **albinchristo04/PPVTV** | Hourly scraper of `api.ppv.st` / `ppv.to` event lists, then tries to pull `.m3u8` links from their embed pages. Latest run: **0 of 176** events had a stream link. No license. | The upstream re-broadcasts pay-TV and PPV (e.g. "NFL Network", UFC cards) with no sign of rights; the extractor sends a spoofed `Referer` to get past the site's hot-link checks. | Written permission from the rights holders, or the event organisers' own free streams. |
| **ydbf/ppv.land** | PHP generator for `ppv.land` / `ppv.wtf` playlists. Published files hold **12 events dated May 2025**, links signed to **expire April 2025**. No license. | Same upstream family as above; stale and expired; needs spoofed `Referer`/`Origin`/`User-Agent` headers that browsers can't send anyway. | Same as above. |
| **chzw2025/ppv** ("测试ppv", test) | 169 entries from `api.ppv.st`; every URL is a **placeholder** (`https://abc.com/stream?uri=...`). No license. | Not streams; same upstream. | Nothing to integrate. |
| **ydbf/PPV-EPG** | XMLTV built from **epgshare01** (NZ and US files) for a list of sports channel ids. No license. | Duplicate of a guide StreamHub already reads directly; no streams. | Not needed. |
| **ohmybahgosh/TiviBro** | MIT-licensed IPTV **player** for LG webOS (plain HTML/JS). | A player, not a source; its webOS code isn't copied. Its guide-first, event-organised layout was the reference for the "Live & Upcoming Sports" row. | — |
| **streamlink/streamlink** | BSD-2 Python CLI that resolves streams from service pages into a local player. | Runs on a computer, not in a browser or the app; service plugins often depend on each site's terms. Reference only. | — |
| **kodi-pvr/pvr.iptvsimple** | GPL-2 Kodi add-on: M3U + XMLTV playback. | Reference for playlist tags (`#EXTVLCOPT` headers, catch-up). GPL code is not copied. | — |
| **matthuisman/slyguy.addons** | Kodi add-ons for streaming services using **your own subscriptions** (and free services). | Kodi-only, each needs that service's account; can't run in StreamHub. | Would need each service's official app or API. |

## Sports and PPV in StreamHub

- **Live & Upcoming Sports** (Home): events found in the TV guides of channels
  that play in StreamHub; times in your device's time zone; the same game on
  several channels is listed once. Live → plays the channel. Upcoming → opens
  the channel's schedule with Remind me. No outside event lists, no links out.
- **PPV**: there is no free, authorised source of pay-per-view streams; PPV
  events appear only when a channel in StreamHub airs them (e.g. preview or
  weigh-in shows on free sports channels).

## Playback notes (browser vs apps)

- HLS: Safari plays it natively; Chrome/Edge/Firefox use hls.js (MSE). The
  iPhone app uses AVPlayer, the Fire TV app ExoPlayer.
- Browsers can't send custom `Referer` / `User-Agent` headers and need CORS;
  such streams are hidden or ranked last on the web and play in the apps.
- DASH plays in the Fire TV app only.
