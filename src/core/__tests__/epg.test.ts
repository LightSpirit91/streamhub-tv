import { describe, expect, it } from 'vitest';
import { collectProgrammes, matchChannels, nowNext, parseChannels, parseXmltvTime, type Programme } from '../epg/xmltv';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="Kan11.il"><display-name lang="he">כאן 11</display-name><display-name>Kan 11</display-name></channel>
  <channel id="5ced7d5df64be98e07ed47b6"><display-name>NFL Channel</display-name></channel>
  <channel id="CBSNews.us"><display-name>CBS News 24/7</display-name></channel>
  <programme start="20261106140000 +0000" stop="20261106150000 +0000" channel="Kan11.il">
    <title>Evening News</title><desc>Top stories &amp; weather</desc><category>News</category>
  </programme>
  <programme start="20261106150000 +0000" stop="20261106160000 +0000" channel="Kan11.il">
    <title><![CDATA[Fauda]]></title><sub-title>Episode 3</sub-title>
  </programme>
  <programme start="20261106143000 +0100" stop="20261106153000 +0100" channel="5ced7d5df64be98e07ed47b6">
    <title>NFL Classics</title>
  </programme>
  <programme start="20261101000000 +0000" stop="20261101010000 +0000" channel="Kan11.il"><title>Old</title></programme>
</tv>`;

describe('xmltv', () => {
  it('parses times with offsets', () => {
    expect(parseXmltvTime('20261106140000 +0000')).toBe(Date.UTC(2026, 10, 6, 14) / 1000);
    expect(parseXmltvTime('20261106143000 +0100')).toBe(Date.UTC(2026, 10, 6, 13, 30) / 1000);
  });

  it('parses channels and programmes inside the window', () => {
    const ch = parseChannels(XML);
    expect(ch.find((c) => c.id === 'Kan11.il')?.names).toContain('Kan 11');
    const into = new Map<string, Programme[]>();
    const from = Date.UTC(2026, 10, 6, 12) / 1000;
    const n = collectProgrammes(XML, new Set(['Kan11.il', '5ced7d5df64be98e07ed47b6']), from, from + 86400, into);
    expect(n).toBe(3);
    const kan = into.get('Kan11.il')!;
    expect(kan[0]).toEqual([Date.UTC(2026, 10, 6, 14) / 1000, Date.UTC(2026, 10, 6, 15) / 1000, 'Evening News', 'Top stories & weather', 'News']);
    expect(kan[1][2]).toBe('Fauda');
    expect(kan[1][3]).toBe('Episode 3');
  });

  it('matches by Pluto id, normalized id and display name', () => {
    const m = matchChannels(
      [
        { id: 'kan11.il', name: 'Kan 11', country: 'IL' },
        { id: 'nflchannel.fast', name: 'NFL Channel', plutoId: '5ced7d5df64be98e07ed47b6' },
        { id: 'cbsnews247.us', name: 'CBS News 24/7', country: 'US' },
        { id: 'unknown.us', name: 'Nope' },
      ],
      parseChannels(XML),
    );
    expect(m.get('kan11.il')).toBe('Kan11.il');
    expect(m.get('nflchannel.fast')).toBe('5ced7d5df64be98e07ed47b6');
    expect(m.get('cbsnews247.us')).toBe('CBSNews.us');
    expect(m.has('unknown.us')).toBe(false);
  });

  it('finds now and next', () => {
    const list: Programme[] = [[100, 200, 'A'], [200, 300, 'B'], [300, 400, 'C']];
    expect(nowNext(list, 250).now?.[2]).toBe('B');
    expect(nowNext(list, 250).next.map((p) => p[2])).toEqual(['C']);
    expect(nowNext(list, 50).now).toBeUndefined();
  });
});

import { sportKind } from '../epg/sports';
describe('sports & fights week', () => {
  it('files events under the right sport', () => {
    expect(sportKind('UFC Fight Night: Main Card')).toBe('fight');
    expect(sportKind('Live Prelims', undefined, { hubs: [], name: 'DAZN Ringside' })).toBe('fight');
    expect(sportKind('Бокс. Сергей Липинец – Марк Урванов')).toBe('fight');
    expect(sportKind('Live: Fútbol Americano Universitario')).toBe('football');
    expect(sportKind('Live: Italian Serie A Soccer')).toBe('soccer');
    expect(sportKind('Хоккей. Кубок Будущего')).toBe('hockey');
    expect(sportKind('Formula 1. Sao Paulo Grand Prix')).toBe('racing');
    expect(sportKind('Clwb Rygbi: Cymru v Japan')).toBe('other');
  });
});
