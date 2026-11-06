# StreamHub TV: Architecture & Build Plan

Last updated: 2026-11-06 · Step 1 of 6 complete

---

## 1. Decisions locked in

| Area | Decision |
|---|---|
| Home layout | **C: Hybrid.** Cinematic hero (live preview) → Continue Watching → Favorites → Live Now → Hub rows. Rows scroll sideways, which is exactly how a TV remote wants to move. |
| Data | Hubs load from targeted country + category feeds. "Explore All" lazy-loads the full 10k+ index only when opened. |
| Refresh | Cache lives 24h. Stale cache shows instantly while a fresh copy downloads in the background. Pull-to-refresh forces it. |
| Dead links | A stream that fails 3 times in a row is hidden. Re-tested on the next 24h refresh. Nightly Channel Doctor removes confirmed-dead links for everyone. |
| Player | Channel zapping, 10 recent channels, Picture-in-Picture, auto-failover, resume on launch. Custom overlay: play/pause, mute, volume, fullscreen, aspect (Fit / Fill / Zoom). |
| Extras | TV Guide (EPG), your own M3U playlists, interface in English / Español / Русский / עברית (with right-to-left layout for Hebrew). |
| Platform | One codebase: Android TV / Fire TV first, phone second. Built with Expo SDK 58 + `react-native-tvos` 0.88. |

---

## 2. Watching on your Samsung TV

Samsung TVs run Tizen, not Android. A React Native app can't install there directly. The clean path:

**Buy a Fire TV Stick 4K Max.** Plug it into the Samsung's HDMI port. That's the whole hardware setup.

- Check the box or listing says **Fire OS**. Skip the **Fire TV Stick 4K Select**: it runs Amazon's newer Vega OS, which doesn't install Android apps.
- Alternative if you prefer Google: **Google TV Streamer**. Same app, same install flow.
- No cable between the stick and your MacBook. Ever. Installs happen over Wi-Fi.
- Your Samsung remote can drive the stick through HDMI-CEC (Samsung calls it **Anynet+**, Settings → General → External Device Manager). Arrows, OK and Back work. The Fire Stick's own remote works too.

**Install flow (about 10 minutes, once):**
1. Fire Stick: Settings → My Fire TV → About → click the device name 7 times. Developer Options unlocks.
2. Developer Options → turn on **Install unknown apps** for the **Downloader** app (free in the Amazon app store).
3. I produce the APK through EAS Build (Expo's cloud build service, free tier). You get a short link.
4. Open Downloader, type the link, install. StreamHub appears on your Fire TV home screen.
5. After that, most updates arrive over the air (EAS Update). No reinstall.

Option later: a native Samsung (Tizen) version. The data engine in `src/core` is pure TypeScript and ports as-is, but Samsung's developer certificate process makes it a project of its own. Not worth it while a stick does the job.

---

## 3. Channels: what's real

Measured on 2026-11-06 from the live feeds, before on-device health checks:

| Hub | Channels | Headliners |
|---|---|---|
| Spotlight | 24 | Channel One, Russia-1, NTV, Kan 11, Now 14, i24, CBS News 24/7, ABC News Live, Bloomberg (4K), MovieSphere, UFC, NFL Channel, MLB, NBA, PFL, Top Rank, Red Bull TV, Love Nature (4K), BBC Earth, WildEarth |
| Sports Arena | 118+ | UFC, NFL Channel, MLB, NBA TV, PFL MMA, Top Rank Classics, Fubo Sports, CBS Sports HQ, CBS Sports Golazo, beIN Sports XTRA, Fight Network, Bellator MMA |
| Fight Night | 20 | UFC, PFL, Bellator MMA, Top Rank Classics, Fight Network, WWE channels, TNA Wrestling, TVS Boxing, Boks TV |
| American Networks | 1,420 | CBS News 24/7, ABC News Live, NBC News NOW, LiveNOW from FOX, FOX Weather, Bloomberg, PBS, MovieSphere, local CBS/FOX stations |
| Russian TV | 447 | Channel One, Russia-1, NTV, Russia-24, TNT, STS, REN TV, Zvezda, Match!, Mir, Russia-K, Carousel |
| Israel | 35 | Kan 11, Keshet 12, Reshet 13, Now 14, i24NEWS (Hebrew/English/French/Arabic), Channel 9 (Russian-language), Knesset, Makan 33 |
| Latin Hub | 1,847 | Mexico, Argentina, Colombia, Chile, Peru, Venezuela, Caribbean + US Spanish-language |
| Wild Planet | 32+ | Love Nature 4K, BBC Earth, WildEarth, PBS Nature, National Geographic feeds, Animal Planet feeds, Naturescape, Pet Collective |
| Extreme | 16+ | Red Bull TV, Xtreme Outdoor by HISTORY, PBR RidePass, Motorvision, Rally TV, Speed Sport 1, Outdoor Channel |
| Cinema & Indie | 129+ | MovieSphere by Lionsgate, IFC, Hallmark Movies & More, FilmRise, Cine Estrella, Western Bound |
| News 24/7 | 134 | US, Canadian, Russian, Israeli and Latin news |
| Canada | 133 | Pluto TV Canada, Samsung TV Plus Canada, Stingray, Global News |

Total: **4,726 channels, 7,148 streams** across 53 sources. Category feeds (sports, movies, documentary, outdoor, science) add more on device; they were unreachable from the build sandbox only.

### What playlists can't carry

Netflix, Hulu, Crave, Max/HBO, Prime Video and UFC pay-per-view are paid, DRM-locked apps, not TV channels. No legitimate playlist link carries them. The copies floating around GitHub are pirated restreams. They die within hours, and Canadian courts have granted Bell and Rogers live blocking orders against exactly those streams. StreamHub does not source or scrape them.

What StreamHub does instead:
- **Your Services row** on the home screen: one-click launch of Netflix, Crave, Disney+, Prime Video and others installed on the Fire Stick. One home screen for everything.
- The **free official channels** those brands run themselves: UFC, PFL, Top Rank, NFL Channel, NBA, MLB, CBS/ABC/NBC news, MovieSphere by Lionsgate, Love Nature, BBC Earth.
- **Your own playlists**: any M3U link you add merges into the same hubs.

### Quality

- 4K streams exist today: Love Nature 4K, Bloomberg TV, Ocean Vibes (9 total). Most of the rest is 1080p or 720p. Russian state channels are mostly 576p at the source.
- The ranker always plays the highest-quality working stream first. HLS adapts up to the best rendition your connection allows.
- The Fire TV Stick 4K Max outputs 4K HDR, so 4K sources play in full 4K.

---

## 4. Self-healing links

```
            nightly (GitHub Actions, ~4 AM Toronto)
┌────────────────────────────────────────────────────────────┐
│ Channel Doctor                                             │
│  pull 58 sources (with mirrors) → merge + dedupe + rank    │
│  → probe every stream → drop dead (404/DNS/garbage)        │
│  → keep geo-locked (403): they may work from Canada        │
│  → publish catalog.json to the `catalog` branch            │
└──────────────────────────────┬─────────────────────────────┘
                               │ one small download
┌──────────────────────────────▼─────────────────────────────┐
│ App (on your Fire Stick)                                   │
│  Tier 1  StreamHub catalog (pre-checked)                   │
│  Tier 2  iptv-org playlists, parsed on device              │
│  Tier 3  raw GitHub + jsDelivr mirrors                     │
│  Cache 24h, stale-while-revalidate                         │
│  Health store: every play success/failure re-ranks streams │
│  Failover: retry 1s, 3s → next stream → 15s → loop         │
└────────────────────────────────────────────────────────────┘
```

New links come in automatically: iptv-org and Free-TV maintainers add and fix streams daily, the Doctor picks them up every night, and the app picks up the Doctor's output every 24h.

Sources (all verified reachable 2026-11-06):
- `iptv-org.github.io/iptv/countries/{us,ca,ru,il,mx,...}.m3u` (primary, with logos + categories)
- `raw.githubusercontent.com/iptv-org/iptv/master/streams/*.m3u` (mirror, split by provider: Pluto, Samsung TV Plus, Roku, Plex, Tubi, Xumo, Stingray, Smotrim, NTV...)
- `iptv-org.github.io/iptv/categories/{sports,movies,documentary,outdoor,science}.m3u` (filtered to your countries)
- `raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8` (+ jsDelivr mirror)
- `iptv-org.github.io/iptv/index.m3u` (Explore All, lazy)

---

## 5. Design: "Marquee"

A dark cinema, lit by whatever you're about to watch.

- **Ambient light.** The background is never flat black. It glows with the focused hub's colors, like bias lighting behind a TV. Moving from Fight Night to Wild Planet shifts the room from red neon to deep emerald.
- **Live Peek.** Rest on a channel for 1.2 seconds and its card turns into a muted live preview. One shared preview player, so it stays fast on a Fire Stick.
- **Hero marquee.** Top of home: a Spotlight channel playing muted behind letterbox bars, a big gold title and a Now/Next line from the TV Guide.
- **Hub personalities.**

  | Hub | Accent | Feel |
  |---|---|---|
  | Spotlight | gold `#F5C451` | velvet rope premiere |
  | Sports Arena | green `#22E07A` | stadium lights |
  | Fight Night | red `#FF3B3B` | neon ring, tale-of-the-tape cards |
  | American Networks | blue `#4D8DFF` | network broadcast |
  | Cinema & Indie | amber `#E8B04A` on wine | film festival |
  | Latin Hub | coral `#FF7A45` to magenta | sunset |
  | Russian TV | ice `#7FD4FF` on navy | winter night |
  | Israel | azure `#5BA8FF` | Mediterranean |
  | Wild Planet | emerald `#3FD08F` | rainforest at dusk |
  | Extreme | yellow `#FFD400` | hazard tape, motion |

- **Cards.** Logo on frosted glass, LIVE pulse dot, 4K gold or HD badges, a thin Now/Next progress line.
- **Zapping wheel.** Press up or down in fullscreen and a channel dial slides in from the left: previous, current, next, with logos and what's on.
- **TV rules.** Focus scale 1.08 with an accent glow ring. 5% safe margins for TV overscan. 24px minimum text on TV. Every screen fully drivable with arrows, OK and Back.

---

## 6. Folder structure

```
streamhub-tv/
├── App.tsx                         boot screen (Step 1), app shell (Step 2)
├── app.json                        Expo config: TV plugin, PiP, cleartext streams
├── eas.json                        cloud build profiles: tv, tv-dev, phone
├── .github/workflows/
│   └── channel-doctor.yml          nightly self-healing catalog       ✅
├── scripts/
│   └── channel-doctor.ts           merge + probe + publish            ✅
├── docs/ARCHITECTURE.md            this file                          ✅
└── src/
    ├── core/                       pure TypeScript, unit tested       ✅
    │   ├── types.ts
    │   ├── m3u/parseM3U.ts         streaming M3U/M3U8 parser
    │   ├── catalog/
    │   │   ├── sources.ts          every playlist + mirrors
    │   │   ├── normalize.ts        quality, flags, trust, country
    │   │   ├── buildCatalog.ts     merge, dedupe, rank, health re-rank
    │   │   ├── hubs.ts             hub rules, popularity, Spotlight
    │   │   ├── loader.ts           parallel fetch with mirror fallback
    │   │   └── cache.ts            24h stale-while-revalidate
    │   ├── search/search.ts        name/country/genre + RU/HE aliases
    │   ├── health/failover.ts      retry/failover machine, zap, recents
    │   └── __tests__/core.test.ts
    ├── services/
    │   └── storage.ts              file cache (catalog) + MMKV (state) ✅
    ├── state/                      zustand stores                     Step 2
    ├── theme/                      Marquee tokens, hub palettes       Step 2
    ├── tv/                         D-pad focus engine, key events     Step 2
    ├── components/                 Hero, Row, ChannelCard, Badges     Step 2
    ├── screens/                    Home, Hub, Search, Library, Guide,
    │                               Settings, Player                   Steps 2-5
    ├── player/                     expo-video wrapper, overlay,
    │                               aspect, failover, zapping, PiP     Step 3
    ├── epg/                        guide fetch + Now/Next              Step 5
    └── i18n/                       en, es, ru, he                     Step 4
```

---

## 7. Build roadmap

| Step | What ships | Status |
|---|---|---|
| 1 | Data engine: parser, sources, ranking, hubs, cache, search, failover, Channel Doctor, TV build config | ✅ done |
| 2 | Marquee design system, Home (hero + rows), Hub pages, D-pad focus engine | next |
| 3 | Player: overlay controls, aspect modes, Retrying overlay, failover, zapping wheel, PiP, recents, resume | |
| 4 | Search, Library/Favorites, My Playlists, Settings, 4 languages + RTL | |
| 5 | TV Guide: nightly XMLTV → compact guide.json, Now/Next everywhere | |
| 6 | Your Services row, first APK on your Fire Stick | |

### Your weekend checklist

- [ ] Buy a Fire TV Stick 4K Max (Fire OS, not Vega OS) and plug it into the Samsung.
- [ ] Create a free account at expo.dev (needed for cloud builds).
- [ ] Turn on Developer Options on the stick and install Downloader (section 2).

---

## Commands

```bash
npm test                         # core unit tests
npm run typecheck
npm run doctor                   # build catalog locally → dist/
npx tsx scripts/channel-doctor.ts --check   # same + probe every stream
EXPO_TV=1 npx expo prebuild -p android      # generate the Android TV project
npx eas-cli build -p android --profile tv   # APK for Fire TV
```
