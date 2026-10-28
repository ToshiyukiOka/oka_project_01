// 頑健性の検証。docs/01 §7。
//   1) パラメータ感度: d・π・λ・α・β を格子で振り、順位の中央値と幅を見る
//   2) 証拠の欠損耐性: カバー辺を確率 keep で間引いて再計算（ブートストラップ）し、順位の 80% 区間を出す
//   3) 素朴なカバー数ランキングとの比較: Kendall τ と、PageRank 化で大きく動いた曲

import type { Dataset, Params } from './types.ts';
import { DEFAULT_PARAMS } from './types.ts';
import { rankWorks } from './legacy.ts';

// 再現性のための決定的乱数（mulberry32）
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo);
};

export interface RankSpread {
  workId: string;
  title: string;
  base: number;
  median: number;
  lo: number; // 10 パーセンタイル
  hi: number; // 90 パーセンタイル
  topK: number; // 上位 K に入った割合
}

function spread(
  runs: Map<string, number>[],
  baseRanks: Map<string, number>,
  titles: Map<string, string>,
  k: number,
): RankSpread[] {
  return [...baseRanks.keys()]
    .map((id) => {
      const rs = runs.map((r) => r.get(id) ?? Infinity);
      return {
        workId: id,
        title: titles.get(id)!,
        base: baseRanks.get(id)!,
        median: quantile(rs, 0.5),
        lo: quantile(rs, 0.1),
        hi: quantile(rs, 0.9),
        topK: rs.filter((x) => x <= k).length / rs.length,
      };
    })
    .sort((a, b) => a.base - b.base);
}

const ranksOf = (ds: Dataset, p: Params, eligible?: Set<string>) =>
  new Map(rankWorks(ds, p, eligible).ranked.map((r) => [r.work.id, r.rank]));

export function parameterGrid(ds: Dataset, eligible?: Set<string>, k = 50) {
  const runs: Map<string, number>[] = [];
  for (const damping of [0.75, 0.85, 0.95])
    for (const performerShare of [0.3, 0.5, 0.7])
      for (const outDegreeExp of [0.5, 1])
        for (const genBonus of [0.25, 0.5, 1])
          for (const crossBonus of [0, 0.3, 0.6])
            runs.push(
              ranksOf(ds, { ...DEFAULT_PARAMS, damping, performerShare, outDegreeExp, genBonus, crossBonus }, eligible),
            );
  const base = ranksOf(ds, DEFAULT_PARAMS, eligible);
  const titles = new Map(ds.works.map((w) => [w.id, w.title]));
  return { configs: runs.length, rows: spread(runs, base, titles, k) };
}

export function edgeBootstrap(ds: Dataset, eligible?: Set<string>, k = 50, B = 300, keep = 0.7, seed = 42) {
  const rand = rng(seed);
  const runs: Map<string, number>[] = [];
  for (let b = 0; b < B; b++) {
    const covers = ds.covers.filter(() => rand() < keep);
    runs.push(ranksOf({ ...ds, covers }, DEFAULT_PARAMS, eligible));
  }
  const base = ranksOf(ds, DEFAULT_PARAMS, eligible);
  const titles = new Map(ds.works.map((w) => [w.id, w.title]));
  return { runs: B, keep, rows: spread(runs, base, titles, k) };
}

// Kendall の τ-b（同順位を考慮）
export function kendallTauB(x: number[], y: number[]): number {
  let c = 0;
  let dsc = 0;
  let tx = 0;
  let ty = 0;
  for (let i = 0; i < x.length; i++)
    for (let j = i + 1; j < x.length; j++) {
      const a = Math.sign(x[i] - x[j]);
      const b = Math.sign(y[i] - y[j]);
      if (a === 0 && b === 0) continue;
      if (a === 0) tx++;
      else if (b === 0) ty++;
      else if (a === b) c++;
      else dsc++;
    }
  const den = Math.sqrt((c + dsc + tx) * (c + dsc + ty));
  return den === 0 ? 0 : (c - dsc) / den;
}

// 素朴なカバー数（同数は平均順位）との比較
export function versusNaiveCount(ds: Dataset, eligible?: Set<string>) {
  const { ranked } = rankWorks(ds, DEFAULT_PARAMS, eligible);
  const counts = ranked.map((r) => r.coverCount);
  const naiveRank = counts.map((c) => {
    const higher = counts.filter((x) => x > c).length;
    const same = counts.filter((x) => x === c).length;
    return higher + (same + 1) / 2;
  });
  const ours = ranked.map((r) => r.rank);
  const tau = kendallTauB(
    ours.map((r) => -r),
    naiveRank.map((r) => -r),
  );
  const movers = ranked
    .map((r, i) => ({ title: r.work.title, ours: r.rank, naive: naiveRank[i], count: r.coverCount, delta: naiveRank[i] - r.rank }))
    .filter((m) => m.count > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { tau, movers };
}
