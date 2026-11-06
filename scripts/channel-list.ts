/**
 * Human-readable channel lists: channels.md (by hub) and channels.csv (all).
 * Written by the Channel Doctor every night next to catalog.json.
 */
import { HUBS } from '../src/core/catalog/hubs';
import type { Catalog, Channel } from '../src/core/types';

const quality = (h: number) => (h >= 2160 ? '4K' : h >= 1080 ? 'Full HD' : h >= 720 ? 'HD' : h > 0 ? 'SD' : '');

const COUNTRY: Record<string, string> = {
  US: 'USA', CA: 'Canada', RU: 'Russia', IL: 'Israel', MX: 'Mexico', AR: 'Argentina', CO: 'Colombia',
  CL: 'Chile', PE: 'Peru', VE: 'Venezuela', EC: 'Ecuador', UY: 'Uruguay', PY: 'Paraguay', BO: 'Bolivia',
  CR: 'Costa Rica', PA: 'Panama', GT: 'Guatemala', HN: 'Honduras', SV: 'El Salvador', NI: 'Nicaragua',
  DO: 'Dominican Rep.', PR: 'Puerto Rico', CU: 'Cuba', UK: 'UK', UA: 'Ukraine', KZ: 'Kazakhstan', BY: 'Belarus',
};
const country = (c?: string) => (c ? COUNTRY[c] ?? c : 'International');

function row(c: Channel, i: number): string {
  const tags = [quality(c.bestHeight), c.streams.length > 1 ? `${c.streams.length} backups` : '']
    .filter(Boolean)
    .join(', ');
  return `| ${i + 1} | ${c.name.replace(/\|/g, '/')} | ${country(c.country)} | ${tags} |`;
}

export function channelsMarkdown(cat: Catalog): string {
  const out = [
    '# StreamHub channel list',
    '',
    `Updated ${new Date(cat.builtAt).toISOString().slice(0, 10)} · **${cat.channels.length.toLocaleString('en-US')} channels**, all free.`,
    'A channel can appear in more than one hub (UFC is in Sports Arena and Fight Night).',
    'Within each hub, the most-watched channels come first.',
    '',
    '## Contents',
    ...HUBS.map((h) => [h, cat.channels.filter((c) => c.hubs.includes(h.id)).length] as const)
      .filter(([, n]) => n > 0)
      .map(([h, n]) => `- [${h.title}](#${h.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}) (${n})`),
    '',
  ];
  for (const h of HUBS) {
    const list = cat.channels.filter((c) => c.hubs.includes(h.id));
    if (!list.length) continue;
    out.push(`## ${h.title}`, '', `${list.length} channels`, '', '| # | Channel | Country | Quality |', '|---|---|---|---|');
    out.push(...list.map(row), '');
  }
  return out.join('\n');
}

export function channelsCsv(cat: Catalog): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = ['Channel,Country,Hubs,Quality,Backup streams'];
  for (const c of cat.channels) {
    const hubs = c.hubs.map((id) => HUBS.find((h) => h.id === id)?.title ?? id).join('; ');
    lines.push([c.name, country(c.country), hubs, quality(c.bestHeight), String(c.streams.length - 1)].map(esc).join(','));
  }
  return lines.join('\n');
}
