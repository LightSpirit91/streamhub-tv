/**
 * Episodes, seasons and programme recordings are not films. Hebrew and
 * Cyrillic need explicit spacing rules (JS \b only understands Latin), and
 * Hebrew "עונה" also means "answers" (גבעת חלפון אינה עונה is a 1976 film),
 * so season/episode words only count when a number follows.
 */
const NOT_A_FILM_PATTERNS: RegExp[] = [
  /(^|[\s(|:-])(עונה|פרק|פרקים)\s*\d/,
  /(^|[\s(|:-])(תכנית|תוכנית|מהדורה|שידור חי)(\s|$)/,
  /(^|[\s(,|:-])\d+\s*(серия|серии)/i,
  /(^|[\s(,|:-])(серия|сезон|выпуск)\s*\d/i,
  /\b(season|episode|temporada|cap[ií]tulo|episodio)\s*\d/i,
  /\bS\d{1,2}\s*E\d{1,3}\b/i,
  /\bep\.?\s*\d/i,
];

export function isFilmTitle(title: string): boolean {
  const t = ` ${title} `;
  return !NOT_A_FILM_PATTERNS.some((re) => re.test(t));
}

/**
 * Studio uploads decorate titles: "Девчата (FullHD, комедия, реж. Ю. Чулюкин, 1961 г.)",
 * "The Shooter (Free ) Classic Western". Keep just the film's name.
 */
export function tidyTitle(raw: string): string {
  return raw
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s*[([](?=[^)\]]*(full\s?hd|\bhd\b|4k|реж\.?|фильм|комедия|драма|мелодрама|боевик|free|full movie|película|completa|\b(19|20)\d\d\b))[^)\]]*[)\]]/giu, '')
    .replace(/\s*[|│].*$/, '')
    .replace(/\s+(full movie|free movie|classic western|classic movie|фильм целиком|полный фильм|סרט מלא|película completa)\b.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s,\-–:]+$/, '')
    .trim();
}

/** TMDB genre names -> StreamHub genre rows. */
const TMDB_TO_OURS: Record<string, string> = {
  Action: 'Adventure', Adventure: 'Adventure', Animation: 'Animation', Comedy: 'Comedy', Crime: 'Crime & Noir',
  Documentary: 'Documentary', Drama: 'Drama', Horror: 'Horror', Mystery: 'Mystery & Thriller', Thriller: 'Mystery & Thriller',
  Romance: 'Romance', 'Science Fiction': 'Sci-Fi', War: 'War', Western: 'Western', Music: 'Musical', History: 'Drama',
};

export function genresFromTmdb(names: string[] | undefined): string[] | undefined {
  const g = [...new Set((names ?? []).map((n) => TMDB_TO_OURS[n]).filter(Boolean))];
  return g.length ? g.slice(0, 3) : undefined;
}
