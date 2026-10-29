// seed/ 以下のファイルから Dataset を組み立てる。
//   works.json        候補作品（作品単位・作家クレジット付き）
//   covers.*.json     カバーの証拠（収集手段ごとに 1 ファイル。全部マージする）
//   collection.json   作品ごとの収集状況（未調査の作品を「カバー 0」と誤認しないため）
//   artists.json      歌い手のデビュー年代・畑・国
//   identities.json   同一の創作主体のグループ（本人・バンド・別名義）
//   notes.json        監修済みの文脈解説（任意）
//   curation.json     名寄せ（表記ゆれ）・除外・種別補正。証拠ファイルは書き換えず、ここで明示的に適用する

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ArtistMeta, Cover, Dataset, Work } from './types.ts';

export interface Collection {
  // complete=false は手順の途中で止まった作品（調査量が他と揃わないのでランキング対象外）
  [workId: string]: { searches: number; method: string; flags?: string; complete?: boolean; queries?: string[] };
}

export interface Loaded {
  ds: Dataset;
  collection: Collection;
  notes: Record<string, string>;
  eligible: Set<string>; // 収集手順を最後まで終えた作品（ランキング対象）
}

export interface Curation {
  aliases?: Record<string, string>; // 収集時の表記 -> 正規の表記（例: ローマ字表記 -> 日本語表記）
  exclude?: Array<{ workId: string; artist: string; reason: string }>;
  kind?: Record<string, Cover['kind']>; // 正規の表記 -> 種別
  // 収集時の出典が公開年を明記している場合に限り、年を補う（持続＝単発バズ補正に使う）
  years?: Array<{ workId: string; artist: string; year: number; reason: string }>;
}

export function applyCuration(covers: Cover[], cur: Curation): Cover[] {
  const key = (workId: string, artist: string) => `${workId}\u0000${artist}`;
  const drop = new Set((cur.exclude ?? []).map((x) => key(x.workId, x.artist)));
  const years = new Map((cur.years ?? []).map((x) => [key(x.workId, x.artist), x.year]));
  return covers
    .filter((c) => !drop.has(key(c.workId, c.artist)))
    .map((c) => {
      const artist = cur.aliases?.[c.artist] ?? c.artist;
      const year = c.year ?? years.get(key(c.workId, c.artist));
      return { ...c, artist, kind: cur.kind?.[artist] ?? c.kind, ...(year !== undefined ? { year } : {}) };
    });
}

const readJson = <T>(p: string, fallback: T): T => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : fallback);

export function loadSeed(dir: string): Loaded {
  const works = readJson<Work[]>(join(dir, 'works.json'), []);
  const covers: Cover[] = [];
  for (const f of readdirSync(dir).filter((f) => /^covers\..+\.json$/.test(f)).sort()) {
    covers.push(...readJson<Cover[]>(join(dir, f), []));
  }
  const artists = readJson<Record<string, ArtistMeta>>(join(dir, 'artists.json'), {});
  const identities = readJson<string[][]>(join(dir, 'identities.json'), []);
  const collection = readJson<Collection>(join(dir, 'collection.json'), {});
  const notes = readJson<Record<string, string>>(join(dir, 'notes.json'), {});
  const curation = readJson<Curation>(join(dir, 'curation.json'), {});
  const curated = applyCuration(covers, curation);

  const eligible = new Set<string>();
  for (const w of works) {
    const c = collection[w.id];
    if (c && c.searches > 0 && c.complete !== false) eligible.add(w.id);
  }
  for (const c of curated) if (c.via.startsWith('youtube')) eligible.add(c.workId);

  return { ds: { works, covers: curated, artists, identities }, collection, notes, eligible };
}
