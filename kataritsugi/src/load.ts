// seed/ 以下のファイルから Dataset を組み立てる。
//   works.json        候補作品（作品単位・作家クレジット付き）
//   covers.*.json     カバーの証拠（収集手段ごとに 1 ファイル。全部マージする）
//   collection.json   作品ごとの収集状況（未調査の作品を「カバー 0」と誤認しないため）
//   artists.json      歌い手のデビュー年代・畑・国
//   identities.json   同一の創作主体のグループ（本人・バンド・別名義）
//   notes.json        監修済みの文脈解説（任意）

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ArtistMeta, Cover, Dataset, Work } from './types.ts';

export interface Collection {
  [workId: string]: { searches: number; method: string; flags?: string };
}

export interface Loaded {
  ds: Dataset;
  collection: Collection;
  notes: Record<string, string>;
  eligible: Set<string>; // 証拠収集を終えた作品（ランキング対象）
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

  const eligible = new Set<string>();
  for (const w of works) if ((collection[w.id]?.searches ?? 0) > 0) eligible.add(w.id);
  for (const c of covers) if (c.via.startsWith('youtube')) eligible.add(c.workId);

  return { ds: { works, covers, artists, identities }, collection, notes, eligible };
}
