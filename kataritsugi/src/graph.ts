// 歌い手 × 作品 の二部グラフを組み立てる。docs/01 §3.1。
//   カバー辺   a --q(a,w)--> w   : 歌い手 a が作品 w を歌い直した（=作品への推薦票）
//   帰属辺     w --share--> o    : 作品 w の権威は原唱者・作詞者・作曲者 o に帰る
// ランダムサーファー解釈: 「ある歌い手のカバーを聴く → その原曲の作り手を聴きに行く → その人がカバーした曲へ …」

import type { Cover, Dataset, Params, Work } from './types.ts';
import { Identity } from './identity.ts';

export interface CoverEdge {
  artist: string; // 代表名（Identity.id）
  workId: string;
  weight: number; // q(a,w)
  cover: Cover;
}

export interface Graph {
  works: Map<string, Work>;
  identity: Identity;
  artistIds: string[]; // 全ノード（カバーした人 ∪ 作り手）
  displayName: Map<string, string>;
  coversByArtist: Map<string, CoverEdge[]>;
  coversByWork: Map<string, CoverEdge[]>;
  creatorsShare: Map<string, Map<string, number>>; // workId -> (creatorId -> 帰属割合, 合計 1)
  artistKind: Map<string, Cover['kind']>;
  dropped: { self: Cover[]; ai: Cover[]; unknownWork: Cover[]; duplicate: Cover[] };
}

// 1 件のカバーが持つ重み。商業リリース（Art Track）と一般投稿で証拠の強さが違う。
// PoC の検索証拠は 1.0 で統一（歌い手の質は PageRank 側で効かせる）。
export function edgeWeight(c: Cover): number {
  if (c.via === 'youtube-ugc') {
    // 一般投稿は再生数で緩やかに加点（log10 なので 100 万回でも 1.0 止まり）
    const v = Math.max(0, c.views ?? 0);
    return Math.min(1, 0.2 + Math.log10(1 + v) / 7.5);
  }
  return 1;
}

export function buildGraph(ds: Dataset, params: Params): Graph {
  const identity = new Identity(ds.identities);
  const works = new Map(ds.works.map((w) => [w.id, w]));
  const displayName = new Map<string, string>();
  const coversByArtist = new Map<string, CoverEdge[]>();
  const coversByWork = new Map<string, CoverEdge[]>();
  const artistKind = new Map<string, Cover['kind']>();
  const dropped: Graph['dropped'] = { self: [], ai: [], unknownWork: [], duplicate: [] };
  const seen = new Set<string>();

  const remember = (name: string) => {
    const id = identity.id(name);
    if (!displayName.has(id)) displayName.set(id, identity.display(name));
    return id;
  };

  for (const c of ds.covers) {
    const w = works.get(c.workId);
    if (!w) {
      dropped.unknownWork.push(c);
      continue;
    }
    if (c.aiSuspect) {
      dropped.ai.push(c);
      continue;
    }
    if (identity.isSelf(c.artist, [...w.original, ...w.lyricist, ...w.composer])) {
      dropped.self.push(c);
      continue;
    }
    const a = remember(c.artist);
    const key = `${a}\u0000${w.id}`;
    if (seen.has(key)) {
      dropped.duplicate.push(c);
      continue;
    }
    seen.add(key);
    const e: CoverEdge = { artist: a, workId: w.id, weight: edgeWeight(c), cover: c };
    (coversByArtist.get(a) ?? coversByArtist.set(a, []).get(a)!).push(e);
    (coversByWork.get(w.id) ?? coversByWork.set(w.id, []).get(w.id)!).push(e);
    // 種別は「より強い」ものを採用（同じ人が pro と net の両方で出てきたら pro）
    const prev = artistKind.get(a);
    if (!prev || params.kindPrior[c.kind] > params.kindPrior[prev]) artistKind.set(a, c.kind);
  }

  // 帰属: 原唱者に π、作詞・作曲者に 1-π。同一主体は合算（シンガーソングライターは全部を受け取る）
  const creatorsShare = new Map<string, Map<string, number>>();
  for (const w of ds.works) {
    const share = new Map<string, number>();
    const add = (name: string, x: number) => {
      const id = remember(name);
      share.set(id, (share.get(id) ?? 0) + x);
    };
    const writers = [...new Set([...w.lyricist, ...w.composer].map((n) => identity.id(n)))];
    const writerNames = writers.map((id) => [...w.lyricist, ...w.composer].find((n) => identity.id(n) === id)!);
    const perf = w.original.length > 0 ? params.performerShare : 0;
    for (const o of w.original) add(o, perf / w.original.length);
    for (const n of writerNames) add(n, (1 - perf) / writerNames.length);
    creatorsShare.set(w.id, share);
  }

  const artistIds = [...displayName.keys()];
  return {
    works,
    identity,
    artistIds,
    displayName,
    coversByArtist,
    coversByWork,
    creatorsShare,
    artistKind,
    dropped,
  };
}
