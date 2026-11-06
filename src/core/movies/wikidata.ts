/**
 * Movie credits from Wikidata (free, open data, no key): director, cast,
 * country, IMDb id and Wikipedia link, looked up by Internet Archive id (P724).
 */
export interface Credits {
  imdbId?: string;
  director: string[];
  cast: string[];
  country?: string;
  wikipedia?: string;
}

export function creditsQuery(archiveIds: string[]): string {
  const values = archiveIds.map((id) => JSON.stringify(id)).join(' ');
  return `SELECT ?ia ?imdb (GROUP_CONCAT(DISTINCT ?dirLabel; separator="|") AS ?dirs)
  (GROUP_CONCAT(DISTINCT ?castLabel; separator="|") AS ?casts) (SAMPLE(?countryLabel) AS ?country) (SAMPLE(?article) AS ?wiki)
WHERE {
  VALUES ?ia { ${values} }
  ?item wdt:P724 ?ia .
  OPTIONAL { ?item wdt:P345 ?imdb }
  OPTIONAL { ?item wdt:P57 ?dir . ?dir rdfs:label ?dirLabel . FILTER(LANG(?dirLabel) = "en") }
  OPTIONAL { ?item wdt:P161 ?c . ?c rdfs:label ?castLabel . FILTER(LANG(?castLabel) = "en") }
  OPTIONAL { ?item wdt:P495 ?co . ?co rdfs:label ?countryLabel . FILTER(LANG(?countryLabel) = "en") }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
} GROUP BY ?ia ?imdb`;
}

interface Binding {
  [k: string]: { value: string } | undefined;
}

export function parseCredits(json: { results?: { bindings?: Binding[] } }): Map<string, Credits> {
  const out = new Map<string, Credits>();
  for (const b of json.results?.bindings ?? []) {
    const ia = b.ia?.value;
    if (!ia) continue;
    const split = (v?: string) => (v ? v.split('|').filter(Boolean) : []);
    out.set(ia, {
      imdbId: b.imdb?.value,
      director: split(b.dirs?.value).slice(0, 3),
      cast: split(b.casts?.value).slice(0, 10),
      country: b.country?.value,
      wikipedia: b.wiki?.value,
    });
  }
  return out;
}
