// Kataritsugi CLI
//   node --experimental-strip-types src/cli.ts rank [--top 50]     ランキングを表示
//   node --experimental-strip-types src/cli.ts report              ランキング + 頑健性 + 解説を out/ に書き出す
//   node --experimental-strip-types src/cli.ts explain <曲名|id>    1 曲の内訳
//   node --experimental-strip-types src/cli.ts status              証拠収集の進捗
//   node --experimental-strip-types src/cli.ts youtube [--limit N]  YouTube Data API で証拠を収集（YOUTUBE_API_KEY 必須）
//   node --experimental-strip-types src/cli.ts quota               全候補を YouTube で収集した場合のクォータ見積り

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSeed } from './load.ts';
import { DEFAULT_PARAMS, type Cover, type Ranked } from './types.ts';
import { rankWorks } from './legacy.ts';
import { credit, explain } from './explain.ts';
import { edgeBootstrap, parameterGrid, versusNaiveCount, type RankSpread } from './robustness.ts';
import { YouTubeClient, collectWork, estimateQuota } from './ingest/youtube.ts';
import { getLLM } from '../../src/agents/llm.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = join(ROOT, 'seed');
const OUT = join(ROOT, 'out');

const args = process.argv.slice(2);
const cmd = args[0] ?? 'rank';
const opt = (name: string, dflt: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};

const pad = (s: string, n: number) => {
  const w = [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0);
  return s + ' '.repeat(Math.max(0, n - w));
};

function table(rows: Ranked[]) {
  console.log(`${pad('#', 4)}${pad('曲', 30)}${pad('年', 6)}${pad('score', 7)}${pad('cover', 6)}${pad('世代', 5)}越境`);
  for (const r of rows) {
    console.log(
      `${pad(String(r.rank), 4)}${pad(r.work.title.slice(0, 14), 30)}${pad(String(r.work.year), 6)}` +
        `${pad(r.score.toFixed(1), 7)}${pad(String(r.coverCount), 6)}${pad(String(r.generations.length), 5)}${r.effectiveGenres.toFixed(1)}`,
    );
  }
}

async function main() {
  const { ds, collection, notes, eligible } = loadSeed(SEED);

  if (cmd === 'status') {
    const done = ds.works.filter((w) => eligible.has(w.id));
    const byVia = new Map<string, number>();
    for (const c of ds.covers) byVia.set(c.via, (byVia.get(c.via) ?? 0) + 1);
    console.log(`作品: ${ds.works.length} / 証拠収集済み: ${done.length} / 未調査: ${ds.works.length - done.length}`);
    console.log(`カバー証拠: ${ds.covers.length} 件`, Object.fromEntries(byVia));
    const pending = ds.works.filter((w) => !eligible.has(w.id)).map((w) => `${w.id} ${w.title}`);
    if (pending.length) console.log(`未調査: ${pending.join(' / ')}`);
    return;
  }

  if (cmd === 'quota') {
    const q = estimateQuota(ds.works);
    console.log(`search ${q.searches} 回 / 約 ${q.units.toLocaleString()} units（既定 ${q.perDayAtDefault.toLocaleString()} units/日 → 約 ${Math.ceil(q.units / q.perDayAtDefault)} 日）`);
    return;
  }

  if (cmd === 'youtube') {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) {
      console.log('YOUTUBE_API_KEY が未設定です。Google Cloud で YouTube Data API v3 のキーを発行して設定してください。');
      process.exitCode = 1;
      return;
    }
    const limit = opt('limit', 10);
    const pages = opt('pages', 1);
    const path = join(SEED, 'covers.youtube.json');
    const existing: Cover[] = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
    const doneIds = new Set(existing.map((c) => c.workId));
    const yt = new YouTubeClient(key);
    const { buildGraph } = await import('./graph.ts');
    const identity = buildGraph(ds, DEFAULT_PARAMS).identity;
    for (const w of ds.works.filter((w) => !doneIds.has(w.id)).slice(0, limit)) {
      const { covers, stats } = await collectWork(w, yt, identity, pages);
      existing.push(...covers);
      writeFileSync(path, JSON.stringify(existing, null, 1));
      console.log(`${w.title}: 候補 ${stats.candidates} → 採用 ${stats.accepted}`, stats.rejected, `quota=${yt.quotaUsed}`);
    }
    return;
  }

  const { ranked, graph, cr } = rankWorks(ds, DEFAULT_PARAMS, eligible);

  if (cmd === 'explain') {
    const q = args[1] ?? '';
    const r = ranked.find((x) => x.work.id === q || x.work.title === q);
    if (!r) {
      console.log(`見つかりません（未調査の作品はランキング対象外です）: ${q}`);
      return;
    }
    console.log(`#${r.rank} 「${r.work.title}」 ${credit(r)}  score=${r.score.toFixed(1)}`);
    console.log(`  CoverRank=${r.coverRank.toExponential(3)} × 世代 ${r.genMultiplier.toFixed(2)} × 越境 ${r.crossMultiplier.toFixed(2)} × 持続 ${r.burstMultiplier.toFixed(2)}`);
    for (const v of r.voters) console.log(`  ${pad(v.artist, 34)} 票 ${v.vote.toExponential(2)}  権威 ${v.authority.toExponential(2)}`);
    const e = await explain(ds, graph, r, notes, getLLM());
    for (const l of e.evidence) console.log(`  - ${l}`);
    if (e.context) console.log(`  ${e.context}`);
    return;
  }

  if (cmd === 'rank') {
    table(ranked.slice(0, opt('top', 50)));
    console.log(`\n対象 ${ranked.length} 曲（未調査 ${ds.works.length - ranked.length} 曲は除外）/ 反復 ${cr.iterations} 回 収束=${cr.converged}`);
    console.log(`除外したカバー: セルフ ${graph.dropped.self.length} / AI 疑い ${graph.dropped.ai.length} / 重複 ${graph.dropped.duplicate.length}`);
    return;
  }

  if (cmd === 'report') {
    const top = opt('top', 50);
    const grid = parameterGrid(ds, eligible, top);
    const boot = edgeBootstrap(ds, eligible, top);
    const naive = versusNaiveCount(ds, eligible);
    const gridBy = new Map(grid.rows.map((r) => [r.workId, r]));
    const bootBy = new Map(boot.rows.map((r) => [r.workId, r]));
    const llm = getLLM();

    mkdirSync(OUT, { recursive: true });
    writeFileSync(
      join(OUT, 'ranking.json'),
      JSON.stringify(
        ranked.map((r) => ({
          rank: r.rank,
          id: r.work.id,
          title: r.work.title,
          year: r.work.year,
          original: r.work.original,
          score: +r.score.toFixed(2),
          coverRank: r.coverRank,
          coverCount: r.coverCount,
          generations: r.generations,
          effectiveGenres: +r.effectiveGenres.toFixed(2),
          multipliers: { gen: r.genMultiplier, cross: r.crossMultiplier, burst: r.burstMultiplier },
          bootstrap80: [bootBy.get(r.work.id)?.lo, bootBy.get(r.work.id)?.hi],
          paramGrid80: [gridBy.get(r.work.id)?.lo, gridBy.get(r.work.id)?.hi],
          voters: r.voters.map((v) => ({ artist: v.artist, vote: v.vote })),
        })),
        null,
        1,
      ),
    );

    const fmt = (s?: RankSpread) => (s ? `${Math.round(s.lo)}–${Math.round(s.hi)}` : '-');
    const md: string[] = [];
    md.push('# 語り継ぎランキング（自動生成）', '');
    md.push(`> 生成: \`npm run report\` / 対象 ${ranked.length} 曲（候補 ${ds.works.length} 曲のうち証拠収集済み）/ カバー証拠 ${ds.covers.length} 件`);
    md.push(`> 素朴なカバー数順位との Kendall τ = ${naive.tau.toFixed(2)}（1 に近いほど「数えるだけ」と同じ）`);
    md.push(`> 頑健性: パラメータ ${grid.configs} 通り / 証拠を 30% 間引くブートストラップ ${boot.runs} 回。区間は 10–90 パーセンタイル順位`, '');
    if (ranked.length < ds.works.length) {
      md.push(
        `> ⚠ **暫定**: 候補 ${ds.works.length} 曲のうち ${ds.works.length - ranked.length} 曲は証拠未収集のため対象外。` +
          'これは確定版の Top 50 ではなく、収集済みの曲だけで動かした途中経過です（`npm run status` で未調査曲を確認）。',
        '',
      );
    }
    md.push('| # | 曲 | 初出 | 原唱 | スコア | カバー | 世代 | 実効ジャンル | 欠損耐性 | パラメータ感度 |');
    md.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const r of ranked.slice(0, top)) {
      md.push(
        `| ${r.rank} | ${r.work.title} | ${r.work.year} | ${r.work.original.join('・') || '—'} | ${r.score.toFixed(1)} | ${r.coverCount} | ${r.generations.length} | ${r.effectiveGenres.toFixed(1)} | ${fmt(bootBy.get(r.work.id))} | ${fmt(gridBy.get(r.work.id))} |`,
      );
    }
    md.push('', '## なぜ語り継ぐべきか', '');
    for (const r of ranked.slice(0, top)) {
      const e = await explain(ds, graph, r, notes, llm);
      md.push(`### ${r.rank}. 「${r.work.title}」 — ${credit(r)}`, '');
      for (const l of e.evidence) md.push(`- ${l}`);
      if (e.context) md.push('', `${e.context}${e.contextSource === 'llm' ? '（LLM 生成）' : ''}`);
      md.push('');
    }
    md.push('## PageRank 化で大きく動いた曲（素朴なカバー数順位との差）', '');
    md.push('| 曲 | 本ランキング | カバー数順位 | カバー数 |', '|---|---|---|---|');
    for (const m of naive.movers.slice(0, 10)) md.push(`| ${m.title} | ${m.ours} | ${m.naive} | ${m.count} |`);
    writeFileSync(join(OUT, 'RANKING.md'), md.join('\n') + '\n');
    console.log(`out/RANKING.md と out/ranking.json を書き出しました（対象 ${ranked.length} 曲, τ=${naive.tau.toFixed(2)}）`);
    return;
  }

  console.log(`unknown command: ${cmd}`);
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
