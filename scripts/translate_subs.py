"""
Adds Spanish, Russian and Hebrew subtitles to films that come with English
subtitles, using Argos Translate (free, open source, runs offline on
GitHub's servers; no account, no outside service). Translated files go to
dist/subs and are listed on each film as "translated automatically".

A time budget keeps each night short; most-watched films go first, and the
library fills in night after night.

Usage: python scripts/translate_subs.py [dist] (env BUDGET_MIN, default 35)
"""
import json
import os
import re
import sys
import time
import urllib.request

OUT = sys.argv[1] if len(sys.argv) > 1 else "dist"
BUDGET = float(os.environ.get("BUDGET_MIN", "35")) * 60
RAW = "https://raw.githubusercontent.com/LightSpirit91/streamhub-tv/catalog/subs"
LANGS = ["es", "ru", "he"]
TIME = re.compile(r"\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}")
start = time.time()


def install():
    import argostranslate.package as pkg

    pkg.update_package_index()
    available = pkg.get_available_packages()
    ok = []
    for lang in LANGS:
        p = next((x for x in available if x.from_code == "en" and x.to_code == lang), None)
        if p is None:
            print(f"no English -> {lang} model available")
            continue
        pkg.install_from_path(p.download())
        ok.append(lang)
    return ok


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "StreamHub-Subtitles/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read(400_000)
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return ""


def cues(text):
    """[(timing line, text)] from SRT / WebVTT."""
    out = []
    for block in re.split(r"\n\s*\n", text.replace("\r", "")):
        lines = [l for l in block.split("\n") if l.strip()]
        for i, l in enumerate(lines):
            if TIME.search(l):
                body = re.sub(r"<[^>]+>|\{\\[^}]*\}", "", "\n".join(lines[i + 1:])).strip()
                if body:
                    out.append((TIME.search(l).group(0).replace(".", ","), body))
                break
    return out


def safe(movie_id, lang):
    return re.sub(r"[^A-Za-z0-9_-]+", "_", movie_id)[:90] + f".{lang}.srt"


def main():
    path = os.path.join(OUT, "movies.json")
    if not os.path.exists(path):
        print("no movie library")
        return
    cat = json.load(open(path, encoding="utf-8"))
    os.makedirs(os.path.join(OUT, "subs"), exist_ok=True)

    def wanted(m):
        have = {s["lang"] for s in m.get("subs") or []}
        return [l for l in LANGS if l not in have and l not in (m.get("subsTranslateTried") or [])]

    queue = [m for m in cat["movies"] if m.get("source") == "archive" and any(s["lang"] == "en" for s in m.get("subs") or []) and wanted(m)]
    queue.sort(key=lambda m: -(m.get("popularity") or 0))
    print(f"films with English subtitles still missing a language: {len(queue)}")
    if not queue:
        return
    langs = install()
    from argostranslate.translate import get_translation_from_codes

    tr = {l: get_translation_from_codes("en", l) for l in langs}
    made = {l: 0 for l in langs}
    for m in queue:
        if time.time() - start > BUDGET:
            break
        en = next(s for s in m["subs"] if s["lang"] == "en")
        try:
            src = cues(fetch(en["url"]))
        except Exception as e:  # unreachable file: try again another night
            print(f"skip {m['id']}: {type(e).__name__}")
            continue
        if len(src) < 20 or len(src) > 4000:
            m["subsTranslateTried"] = LANGS
            continue
        for lang in wanted(m):
            if lang not in tr or time.time() - start > BUDGET:
                continue
            lines = [f"{i + 1}\n{t}\n{tr[lang].translate(body)}\n" for i, (t, body) in enumerate(src)]
            name = safe(m["id"], lang)
            with open(os.path.join(OUT, "subs", name), "w", encoding="utf-8") as f:
                f.write("\n".join(lines))
            m["subs"].append({"lang": lang, "url": f"{RAW}/{name}", "auto": True})
            made[lang] += 1
        json.dump(cat, open(path, "w", encoding="utf-8"), ensure_ascii=False)
    with_sub = {l: sum(1 for m in cat["movies"] if any(s["lang"] == l for s in m.get("subs") or [])) for l in ["en"] + LANGS}
    report = (
        "# Translated subtitles\n\n"
        f"- Tonight: {', '.join(f'{l} {n}' for l, n in made.items())} ({int(time.time() - start)}s)\n"
        f"- Films with subtitles: " + " · ".join(f"{l} {n}" for l, n in with_sub.items()) + "\n\n"
        "Translations by Argos Translate (open source), made automatically.\n"
    )
    open(os.path.join(OUT, "subs-report.md"), "w").write(report)
    print(report)


main()
