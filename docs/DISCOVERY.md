# Refresh, playback checks and daily discovery

Everything runs on free GitHub Actions minutes (public repo). Cost cap: **$0**.
No paid service, no new keys, nothing deployed outside GitHub.

## Settings: `config/refresh.json`

Edit it on GitHub (pencil icon). Out-of-range values are clamped.

| Setting | Default | What it does |
|---|---|---|
| `refresh.channelsEveryHours` | 24 | Channel Doctor (links, movies, shows). 24 = nightly; 48 = every other night. Below 24 needs an extra schedule (ask). |
| `refresh.guideEveryHours` | 6 | TV guide refresh (runs at most every 6 h). |
| `playbackCheck.deep` | true | Real playback check (below). `false` = old check: the playlist answers. |
| `playbackCheck.failuresBeforeRemoval` | 3 | Failed nights in a row before a link (or a whole source) is removed. |
| `playbackCheck.recheckRemovedEveryDays` | 7 | Removed links and switched-off sources are re-tested this often (backoff). |
| `playbackCheck.timeoutSeconds` / `concurrency` | 10 / 48 | Per request; checks at once. |
| `limits.maxRequestsPerRun` | 60000 | Hard cap on requests per run. |
| `limits.maxRunMinutes` | 70 | Time cap; about half goes to link checks. |
| `discovery.*` | | Searches, repos per run, playlists per repo, size cap, new links per run, `excludedRepos`, `excludedHosts`, `trustedHosts`. |
| `excludedSources` | [] | Source ids (from `src/core/catalog/sources.ts`) to skip, e.g. `"iptv-org:raw:us_frequency"`. |
| `snapshotsToKeep` | 7 | Nights kept for rollback. |
| `publishGuard.maxChannelDropPercent` | 30 | If tonight finds this much fewer channels, yesterday's list is kept. |

The app shows these (read only) in **Live TV → Sources → Refresh & health**.

## Real playback check

A link counts as working only when it leads to real video:

1. playlist → first variant → media playlist → first segment;
2. the segment's first bytes must be video/audio (MPEG-TS sync bytes,
   fragmented MP4 boxes, AAC/ID3, WebM);
3. rejected: HTML or JSON error pages, empty playlists, live playlists that
   have ended (expired links), anything that redirects to an unsafe address.

Results per link: **play** · **strike** (failed tonight, kept) · **removed**
(404/410 at once, or 3 failed nights) · **geo-locked** (401/403/451, kept:
often works from Canada) · **no answer** (timeout, kept). Failures are retried
in the same run after 2 s and 6 s. One good night clears the strikes.

A source (playlist) with no working link for 3 nights is switched off and
retried weekly. State: `health.json` on the catalog branch.

## Safety

- Only `http`/`https`; no user:password URLs; no service ports (SSH, mail,
  databases...).
- The address is checked **after DNS**, inside the connection, so a name that
  points at a private, loopback, link-local or cloud-metadata address is
  refused; every redirect is re-checked.
- Size and time caps per response, request and time caps per run.
- Repository content is **data**: playlists are parsed as text; names,
  descriptions and README text are never followed as instructions, and nothing
  from a repository is executed. Output lines are sanitised.
- The discovery job that reads other repositories has read-only permissions and
  no saved credentials; a separate job publishes only the expected files.

## Daily discovery

`scripts/discovery.ts`, workflow **Discovery**.

1. GitHub repository search (`discovery.searches`), no forks or archived
   repos, pushed in the last 30 days.
2. Repos whose last push hasn't changed are skipped (`discovery/repos.json`).
3. Repo rules: PPV / pay-TV restream projects are skipped (ppv.to / streamed.su
   families, crackstreams, daddylive and similar), as are iptv-org, Free-TV
   and Famelack (already read directly) and `excludedRepos`.
4. Link rules: safe address; not YouTube / Samsung TV Plus / Plex; no faked
   Referer/User-Agent; no account logins (Xtream / portal links); no
   short-lived signed links; no PPV names; and served from a broadcaster or
   free-TV host StreamHub **already plays from** its vetted sources (or a host
   in `trustedHosts`). Shared hosting (CloudFront, GitHub Pages, Workers...)
   only counts with an exact host match.
5. The real playback check. Passing links go to `discovered.m3u` (source
   **Daily discovery**, switchable in the app) and are re-checked every night.

**Schedule: OFF until you approve.** Today it runs only from the Actions tab
(Discovery → Run workflow; untick "Publish" for a dry run). To run it daily,
uncomment the two `schedule` lines at the top of
`.github/workflows/discovery.yml` (7:05 AM Toronto).

## Audit history and rollback

- `history/audit.jsonl`: one line per published run (job, counts, channels
  added/removed, links discovered, publish-guard notes).
- `history/<date>/`: gzipped snapshot of catalog, movies, shows, graveyard,
  health and discovered links; the newest `snapshotsToKeep` nights kept.
- **Rollback**: Actions → Rollback → Run workflow → type the date
  (YYYY-MM-DD). The Refresh & health panel lists the kept dates.

## Sports & Fights

`epg-doctor.ts` builds `sports-week.json` from every channel's week-long
guide: live and upcoming events (no replays, highlights, previews, magazine
shows), merged across channels, filed by sport (Fights, Soccer, Football,
Hockey, Basketball, Baseball, Racing, Tennis, Golf, More). In the app: Home →
Live & Upcoming Sports → See all, or Live TV → Sports week. Live events play
here; upcoming ones open the channel's schedule with Remind me. No outside
event lists and no links out.
