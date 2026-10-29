import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Cover, Dataset, Work } from '../src/types.ts';
import { DEFAULT_PARAMS } from '../src/types.ts';
import { buildGraph } from '../src/graph.ts';
import { coverRank } from '../src/coverrank.ts';
import { rankWorks, burstMultiplier } from '../src/legacy.ts';
import { kendallTauB } from '../src/robustness.ts';

const work = (id: string, original: string, year = 1970, genre: Work['genre'] = 'kayo'): Work => ({
  id,
  title: id,
  original: [original],
  lyricist: [original],
  composer: [original],
  year,
  genre,
  intl: false,
});
const cover = (workId: string, artist: string, extra: Partial<Cover> = {}): Cover => ({
  workId,
  artist,
  kind: 'pro',
  via: 'title',
  src: 'test',
  ...extra,
});

// Star は自作 W3 を 3 人にカバーされている「歌い手の歌い手」。Nobody は誰にもカバーされていない。
// Star が W1 を、Nobody が W2 をそれぞれ 1 曲だけカバーする。
function starVsNobody(): Dataset {
  return {
    works: [work('W1', 'O1'), work('W2', 'O2'), work('W3', 'Star')],
    covers: [
      cover('W1', 'Star'),
      cover('W2', 'Nobody'),
      cover('W3', 'A'),
      cover('W3', 'B'),
      cover('W3', 'C'),
    ],
    artists: {},
    identities: [],
  };
}

test('権威の総量が保存される（λ=1 の純 PageRank）', () => {
  const g = buildGraph(starVsNobody(), DEFAULT_PARAMS);
  const r = coverRank(g, DEFAULT_PARAMS);
  const total = [...r.authority.values()].reduce((a, b) => a + b, 0);
  assert.ok(r.converged);
  assert.ok(Math.abs(total - 1) < 1e-9, `sum=${total}`);
});

test('権威ある歌い手の 1 票は、無名の歌い手の 1 票より重い', () => {
  const g = buildGraph(starVsNobody(), DEFAULT_PARAMS);
  const r = coverRank(g, DEFAULT_PARAMS);
  assert.ok(r.workRank.get('W1')! > r.workRank.get('W2')!);
  assert.ok(r.authority.get(g.identity.id('Star'))! > r.authority.get(g.identity.id('Nobody'))!);
});

test('多くの曲をカバーする人の 1 票は分割される（選択性）', () => {
  const ds: Dataset = {
    works: ['X', 'Y1', 'Y2', 'Y3', 'Y4'].map((id) => work(id, `orig-${id}`)),
    covers: [cover('X', 'Selective'), ...['Y1', 'Y2', 'Y3', 'Y4'].map((w) => cover(w, 'Prolific'))],
    artists: {},
    identities: [],
  };
  const pure = { ...DEFAULT_PARAMS, minOutDegree: 1 };
  const r = coverRank(buildGraph(ds, pure), pure);
  assert.ok(Math.abs(r.workRank.get('X')! - 4 * r.workRank.get('Y1')!) < 1e-12);
  // 分母の下限 k=3: 1 曲しか観測されない人の票は 1/3 に、4 曲の人は 1/4 になる（比は 4/3）
  const floored = coverRank(buildGraph(ds, DEFAULT_PARAMS), DEFAULT_PARAMS);
  assert.ok(Math.abs(floored.workRank.get('X')! - (4 / 3) * floored.workRank.get('Y1')!) < 1e-12);
  const total = [...floored.authority.values()].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `使われなかった票も保存される sum=${total}`);
});

test('出典 URL の無い証拠はグラフに入れない', () => {
  const ds: Dataset = {
    works: [work('W', 'O')],
    covers: [cover('W', 'a'), cover('W', 'b', { src: '' })],
    artists: {},
    identities: [],
  };
  const g = buildGraph(ds, DEFAULT_PARAMS);
  assert.equal(g.coversByWork.get('W')!.length, 1);
  assert.equal(g.dropped.unsourced.length, 1);
});

test('セルフカバー（本人・在籍バンド・作家）は伝承として数えない', () => {
  const ds: Dataset = {
    works: [{ ...work('W', 'バンドA'), lyricist: ['作詞家'], composer: ['ボーカルB'] }],
    covers: [cover('W', 'バンドA'), cover('W', 'ボーカル B'), cover('W', '作詞家'), cover('W', '他人')],
    artists: {},
    identities: [['バンドA', 'ボーカルB']],
  };
  const g = buildGraph(ds, DEFAULT_PARAMS);
  assert.equal(g.coversByWork.get('W')!.length, 1);
  assert.equal(g.dropped.self.length, 3);
});

test('AI 歌声の疑いがあるカバーは除外される', () => {
  const ds: Dataset = {
    works: [work('W', 'O')],
    covers: [cover('W', 'human'), cover('W', 'clone', { aiSuspect: true })],
    artists: {},
    identities: [],
  };
  const g = buildGraph(ds, DEFAULT_PARAMS);
  assert.equal(g.coversByWork.get('W')!.length, 1);
  assert.equal(g.dropped.ai.length, 1);
});

test('世代到達は「原曲より後の年代にデビューした歌い手」の年代数', () => {
  const ds: Dataset = {
    works: [work('W', 'O', 1975)],
    covers: ['older', 'same', 'g80', 'g80b', 'g00', 'unknown'].map((a) => cover('W', a)),
    artists: {
      older: { debutDecade: 1960 },
      same: { debutDecade: 1970 },
      g80: { debutDecade: 1980 },
      g80b: { debutDecade: 1980 },
      g00: { debutDecade: 2000 },
    },
    identities: [],
  };
  const r = rankWorks(ds, DEFAULT_PARAMS).ranked[0];
  assert.deepEqual(r.generations, [1980, 2000]);
  assert.equal(r.genMultiplier, 1 + DEFAULT_PARAMS.genBonus * (2 / DEFAULT_PARAMS.genCap));
});

test('同じ畑の歌い手だけに歌われた曲より、畑を越えた曲の越境補正が大きい', () => {
  const mk = (genres: Array<'enka' | 'rock' | 'jazz' | 'jpop'>): Dataset => ({
    works: [work('W', 'O', 1970, 'enka')],
    covers: genres.map((_, i) => cover('W', `a${i}`)),
    artists: Object.fromEntries(genres.map((g, i) => [`a${i}`, { genre: g }])),
    identities: [],
  });
  const same = rankWorks(mk(['enka', 'enka', 'enka', 'enka']), DEFAULT_PARAMS).ranked[0];
  const mixed = rankWorks(mk(['enka', 'rock', 'jazz', 'jpop']), DEFAULT_PARAMS).ranked[0];
  assert.equal(same.crossMultiplier, 1);
  assert.ok(mixed.crossMultiplier > 1.15);
});

test('カバーが 2 年窓に集中する曲は減点、長期に分散する曲は減点なし', () => {
  const ds = (years: number[]): Dataset => ({
    works: [work('W', 'O')],
    covers: years.map((y, i) => cover('W', `a${i}`, { year: y })),
    artists: {},
    identities: [],
  });
  const p = DEFAULT_PARAMS;
  const burst = buildGraph(ds([2020, 2020, 2020, 2021, 2021, 2021]), p);
  const spread = buildGraph(ds([1980, 1988, 1995, 2003, 2011, 2019]), p);
  assert.equal(burstMultiplier(burst, ds([]).works[0], p), p.burstFloor);
  assert.equal(burstMultiplier(spread, ds([]).works[0], p), 1);
});

test('Kendall τ-b', () => {
  assert.equal(kendallTauB([1, 2, 3, 4], [1, 2, 3, 4]), 1);
  assert.equal(kendallTauB([1, 2, 3, 4], [4, 3, 2, 1]), -1);
});

test('歌い手のメタデータは名寄せ後の代表名ではなくクレジット表記で引く', () => {
  const ds: Dataset = {
    works: [work('W', 'O', 1975)],
    covers: [cover('W', 'ソロ歌手')],
    artists: { ソロ歌手: { debutDecade: 1990 }, 在籍バンド: { debutDecade: 1960 } },
    identities: [['在籍バンド', 'ソロ歌手']],
  };
  assert.deepEqual(rankWorks(ds, DEFAULT_PARAMS).ranked[0].generations, [1990]);
});

test('同時代内 z: 同じ年代の中で突出した曲が正、埋もれた曲が負になる', async () => {
  const { cohortZ } = await import('../src/legacy.ts');
  const ws = [2001, 2002, 2003, 2004, 2005, 2006].map((y, i) => work(`N${i}`, `o${i}`, y));
  const covers = ws.flatMap((w, i) => Array.from({ length: i + 1 }, (_, k) => cover(w.id, `${w.id}-c${k}`)));
  const z = cohortZ(rankWorks({ works: ws, covers, artists: {}, identities: [] }, DEFAULT_PARAMS).ranked);
  assert.ok(z.get('N5')! > 0 && z.get('N0')! < 0);
});

test('キュレーションで補った公開年により、単発バズ補正が効く', async () => {
  const { applyCuration } = await import('../src/load.ts');
  const covers = ['a', 'b', 'c', 'd', 'e'].map((x) => cover('W', x));
  const curated = applyCuration(covers, {
    years: ['a', 'b', 'c', 'd', 'e'].map((artist) => ({ workId: 'W', artist, year: 2020, reason: 'test' })),
  });
  const ds: Dataset = { works: [work('W', 'O', 2019)], covers: curated, artists: {}, identities: [] };
  assert.equal(rankWorks(ds, DEFAULT_PARAMS).ranked[0].burstMultiplier, DEFAULT_PARAMS.burstFloor);
});
