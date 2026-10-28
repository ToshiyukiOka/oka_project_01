// CoverRank — 歌い手×作品 二部グラフ上の PageRank。docs/01 §3.2。
//
//   R(o) = (1-d)·p(o) + d·D·p(o) + U·p(o) + Σ_w S(w)·share(o, w)
//   S(w) = d · Σ_{a→w} R(a) · q(a,w) / max(Σ_v q(a,v), k)^λ
//
//   R: 歌い手（作り手）の権威。「自分の曲が、権威ある歌い手に歌い直されている人」ほど高い。
//   S: 作品の CoverRank。「権威ある歌い手が、自分の 1 票を割いて歌い直した作品」ほど高い。
//   p: テレポート事前分布（票を持つ = 1 曲以上カバーしている歌い手のみ。種別で重み付け）
//   D: カバーを持たない人（作り手のみ）の質量。p に従って再配分する（dangling 処理）
//   k: 票の分母の下限。候補曲プールは歌い手の全レパートリーの一部しか見ていないため、
//      プール内で 1 曲しか観測されない歌い手が 1 票を丸ごと注ぐのを防ぐ。
//      使われなかった分 U は「観測されていないカバー先」とみなし、p に従って再配分する
//   λ=1 で行確率行列になり、Σ R = 1 が保たれる純 PageRank。λ<1 は毎反復で正規化する。

import type { Params } from './types.ts';
import type { Graph } from './graph.ts';

export interface CoverRankResult {
  authority: Map<string, number>; // R
  workRank: Map<string, number>; // S
  contributions: Map<string, Array<{ artist: string; name: string; vote: number }>>; // 作品ごとの票の内訳（name はクレジット表記）
  iterations: number;
  converged: boolean;
}

export function coverRank(g: Graph, params: Params, maxIter = 1000, tol = 1e-12): CoverRankResult {
  const { damping: d, outDegreeExp: lambda } = params;
  const ids = g.artistIds;
  const idx = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;

  // テレポート事前分布: 票を持つ人だけに、種別の重みで配る
  const prior = new Float64Array(n);
  let pSum = 0;
  for (const [a, edges] of g.coversByArtist) {
    if (edges.length === 0) continue;
    const k = g.artistKind.get(a) ?? 'pro';
    prior[idx.get(a)!] = params.kindPrior[k];
    pSum += params.kindPrior[k];
  }
  if (pSum === 0) prior.fill(1 / n);
  else for (let i = 0; i < n; i++) prior[i] /= pSum;

  // 歌い手ごとの分母 max(Σq, k)^λ
  const denom = new Map<string, number>();
  for (const [a, edges] of g.coversByArtist) {
    denom.set(a, Math.pow(Math.max(edges.reduce((s, e) => s + e.weight, 0), params.minOutDegree), lambda));
  }

  let R = Float64Array.from(prior);
  let S = new Map<string, number>();
  let iterations = 0;
  let converged = false;

  const flowToWorks = (Rv: Float64Array) => {
    const s = new Map<string, number>();
    for (const [a, edges] of g.coversByArtist) {
      const ra = Rv[idx.get(a)!];
      const den = denom.get(a)!;
      for (const e of edges) s.set(e.workId, (s.get(e.workId) ?? 0) + (d * ra * e.weight) / den);
    }
    return s;
  };

  for (; iterations < maxIter; iterations++) {
    S = flowToWorks(R);
    let dangling = 0;
    let voterMass = 0;
    for (let i = 0; i < n; i++) {
      if (g.coversByArtist.has(ids[i])) voterMass += R[i];
      else dangling += R[i];
    }
    let spent = 0;
    for (const sw of S.values()) spent += sw;
    const unspent = Math.max(0, d * voterMass - spent); // 分母の下限で使われなかった票（λ=1 のとき）

    const next = new Float64Array(n);
    for (let i = 0; i < n; i++) next[i] = ((1 - d) + d * dangling + unspent) * prior[i];
    for (const [w, sw] of S) {
      const share = g.creatorsShare.get(w);
      if (!share) continue;
      for (const [o, x] of share) next[idx.get(o)!] += sw * x;
    }
    // λ<1 では総量が 1 を超えるため正規化（λ=1 では数値誤差の補正のみ）
    let total = 0;
    for (let i = 0; i < n; i++) total += next[i];
    let diff = 0;
    for (let i = 0; i < n; i++) {
      next[i] /= total;
      diff += Math.abs(next[i] - R[i]);
    }
    R = next;
    if (diff < tol) {
      converged = true;
      iterations++;
      break;
    }
  }
  S = flowToWorks(R);

  const authority = new Map(ids.map((id, i) => [id, R[i]]));
  const contributions = new Map<string, Array<{ artist: string; name: string; vote: number }>>();
  for (const [w, edges] of g.coversByWork) {
    contributions.set(
      w,
      edges
        .map((e) => ({
          artist: e.artist,
          name: e.cover.artist,
          vote: (d * R[idx.get(e.artist)!] * e.weight) / denom.get(e.artist)!,
        }))
        .sort((x, y) => y.vote - x.vote),
    );
  }
  return { authority, workRank: S, contributions, iterations, converged };
}
