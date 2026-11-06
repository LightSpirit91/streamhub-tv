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
