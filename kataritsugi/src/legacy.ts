// 語り継ぎの補正項と最終スコア。docs/01 §4–§5。
//
//   語り継ぎスコア(w) = CoverRank(w) × 世代到達(w) × 越境(w) × 持続(w)
//
//   世代到達 = 1 + α · min(1, 原曲より後の年代にデビューした歌い手の「年代数」 / genCap)
//   越境     = 1 + β · min(1, (実効ジャンル数 − 1) / 3)      ※実効ジャンル数 = exp(シャノンエントロピー)
//   持続     = 単発バズ補正。カバーの過半が 2 年窓に集中するほど減点（年情報が 5 件未満なら 1）

import type { ArtistMeta, Dataset, Genre, Params, Ranked, Work } from './types.ts';
import type { Graph } from './graph.ts';
import { buildGraph } from './graph.ts';
import { coverRank, type CoverRankResult } from './coverrank.ts';
import { normName } from './identity.ts';

// 越境の判定は粗いカテゴリで行う（細かいラベルで多様性が水増しされないように）
type Field = 'kayo' | 'folk' | 'pop' | 'rock' | 'jazz' | 'anime' | 'okinawa' | 'net' | 'foreign';
const FIELD: Record<Genre, Field> = {
  enka: 'kayo',
  kayo: 'kayo',
  folk: 'folk',
  newmusic: 'folk',
  citypop: 'pop',
  jpop: 'pop',
  idol: 'pop',
  rock: 'rock',
  jazz: 'jazz',
  doyo: 'jazz',
  anime: 'anime',
  vocaloid: 'anime',
  okinawa: 'okinawa',
};

export const FIELD_LABEL: Record<Field, string> = {
  kayo: '歌謡・演歌',
  folk: 'フォーク/NM',
  pop: 'ポップス',
  rock: 'ロック',
  jazz: 'ジャズ/声楽',
  anime: 'アニソン',
  okinawa: '沖縄',
  net: 'ネット',
  foreign: '海外',
};

const decadeOf = (year: number) => Math.floor(year / 10) * 10;

// メタデータはクレジット表記で引く（名寄せ後の代表名だと「桑田佳祐 → サザン」のように別人の経歴を引いてしまう）
export function lookupMeta(ds: Dataset, g: Graph, artistId: string, credited?: string): ArtistMeta {
  for (const name of [credited, g.displayName.get(artistId), artistId]) {
    if (!name) continue;
    const m = ds.artists[name] ?? metaByNorm(ds).get(normName(name));
    if (m) return m;
  }
  return {};
}

const normCache = new WeakMap<Dataset, Map<string, ArtistMeta>>();
function metaByNorm(ds: Dataset) {
  let m = normCache.get(ds);
  if (!m) {
    m = new Map(Object.entries(ds.artists).map(([k, v]) => [normName(k), v]));
    normCache.set(ds, m);
  }
  return m;
}

export function fieldOf(ds: Dataset, g: Graph, artistId: string, credited?: string): Field | undefined {
  const kind = g.artistKind.get(artistId);
  const meta = lookupMeta(ds, g, artistId, credited);
  if (kind === 'foreign' || (meta.country && meta.country !== 'JP')) return 'foreign';
  if (kind === 'net') return 'net';
  if (kind === 'choir') return 'jazz';
  return meta.genre ? FIELD[meta.genre] : undefined;
}

export function generationsReached(ds: Dataset, g: Graph, w: Work): number[] {
  const base = decadeOf(w.year);
  const decades = new Set<number>();
  for (const e of g.coversByWork.get(w.id) ?? []) {
    const dd = lookupMeta(ds, g, e.artist, e.cover.artist).debutDecade;
    if (dd !== undefined && dd > base) decades.add(dd);
  }
  return [...decades].sort((a, b) => a - b);
}

export function crossover(ds: Dataset, g: Graph, w: Work) {
  // 原曲のジャンルも 1 票として入れる（演歌 → 全員ロック、も越境として測れるように）
  const counts = new Map<Field, number>([[FIELD[w.genre], 1]]);
  let foreign = 0;
  for (const e of g.coversByWork.get(w.id) ?? []) {
    const f = fieldOf(ds, g, e.artist, e.cover.artist);
    if (!f) continue;
    if (f === 'foreign') foreign++;
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  let h = 0;
  for (const c of counts.values()) h -= (c / total) * Math.log(c / total);
  return { effective: Math.exp(h), foreign, fields: counts };
}

export function burstMultiplier(g: Graph, w: Work, params: Params): number {
  const years = (g.coversByWork.get(w.id) ?? [])
    .map((e) => e.cover.year)
    .filter((y): y is number => typeof y === 'number')
    .sort((a, b) => a - b);
  if (years.length < 5) return 1;
  let best = 0;
  for (let i = 0, j = 0; i < years.length; i++) {
    while (years[i] - years[j] > 1) j++;
    best = Math.max(best, i - j + 1);
  }
  const conc = best / years.length;
  return 1 - (1 - params.burstFloor) * Math.max(0, (conc - 0.5) / 0.5);
}

export interface RankOutput {
  ranked: Ranked[];
  graph: Graph;
  cr: CoverRankResult;
}

// works を絞り込む場合（未調査の作品を除外するなど）は eligible で指定する。
// グラフ自体は全作品で組む（未調査曲の作り手も権威の受け皿として残す）。
export function rankWorks(ds: Dataset, params: Params, eligible?: Set<string>): RankOutput {
  const graph = buildGraph(ds, params);
  const cr = coverRank(graph, params);
  const rows: Omit<Ranked, 'rank' | 'score'>[] = [];
  for (const w of ds.works) {
    if (eligible && !eligible.has(w.id)) continue;
    const coverRankW = cr.workRank.get(w.id) ?? 0;
    const gens = generationsReached(ds, graph, w);
    const genMultiplier = 1 + params.genBonus * Math.min(1, gens.length / params.genCap);
    const x = crossover(ds, graph, w);
    const crossMultiplier = 1 + params.crossBonus * Math.min(1, (x.effective - 1) / 3);
    const burst = burstMultiplier(graph, w, params);
    rows.push({
      work: w,
      raw: coverRankW * genMultiplier * crossMultiplier * burst,
      coverRank: coverRankW,
      coverCount: graph.coversByWork.get(w.id)?.length ?? 0,
      generations: gens,
      genMultiplier,
      effectiveGenres: x.effective,
      foreignCount: x.foreign,
      crossMultiplier,
      burstMultiplier: burst,
      voters: (cr.contributions.get(w.id) ?? []).map((v) => ({
        artist: v.name,
        vote: v.vote,
        authority: cr.authority.get(v.artist) ?? 0,
      })),
    });
  }
  rows.sort((a, b) => b.raw - a.raw || b.coverCount - a.coverCount || a.work.year - b.work.year);
  const top = rows[0]?.raw || 1;
  const ranked = rows.map((r, i) => ({ ...r, rank: i + 1, score: (100 * r.raw) / top }));
  return { ranked, graph, cr };
}
