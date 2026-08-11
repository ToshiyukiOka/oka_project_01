// 歩くスケルトンの実行エントリ。
//   node --experimental-strip-types src/cli/main.ts demo   # 全体を一周（推奨）
//   npm run demo
// 取り込み→自己モデル→AsIs→介入(提案)→伴走(Brief) の最小一周をオフラインで動かす。

import { rmSync } from 'node:fs';
import { InMemoryStore } from '../core/store.ts';
import { getLLM } from '../agents/llm.ts';
import { runCycle } from '../core/loop.ts';
import { seedPersona, applyScenario, INDIE_HACKER_ANSWERS, type Scenario } from '../ontology/seed.ts';
import { INTERVIEW_QUESTIONS } from '../agents/interviewer.ts';
import type { ProposedAction } from '../ontology/types.ts';

const DATA = 'data/ontology.json';
const cmd = process.argv[2] ?? 'demo';
const nowMs = Date.now();

async function main() {
  const llm = getLLM();
  const engine = llm.kind === 'claude' ? 'Claude (real)' : 'Stub (offline)';

  if (cmd === 'reset') {
    rmSync(DATA, { force: true });
    console.log('reset done.');
    return;
  }

  if (cmd === 'brief') {
    const store = new InMemoryStore(DATA);
    if (store.getObjects('Goal').length === 0) {
      console.log('データが空です。先に `npm run demo` を実行してください。');
      return;
    }
    store.markOpened(new Date(nowMs).toISOString());
    const brief = await runCycle(store, llm, nowMs);
    console.log('\n' + brief.text + '\n');
    return;
  }

  // ================= demo: フル一周 =================
  console.log('='.repeat(64));
  console.log(`Personal Brain OS (Kagami) — walking skeleton   [LLM: ${engine}]`);
  console.log('ウェッジ: ソロ起業家 / インディーハッカー');
  console.log('='.repeat(64));

  // (1) Import は必須にしない。まず Interview だけで自己モデルを作る（docs/05 §3）
  console.log('\n【1】Interview（ゼロデータ・オンボーディング / コネクタ接続なしで開始）');
  for (const { key, q } of INTERVIEW_QUESTIONS) {
    console.log(`   Q: ${q}`);
    console.log(`   A: ${INDIE_HACKER_ANSWERS[key]}`);
  }

  // (2) 対話から Personal Ontology を構築（DATA に永続化）
  rmSync(DATA, { force: true });
  const store = new InMemoryStore(DATA);
  await seedPersona(store, llm);
  console.log('\n【2】Personal Ontology を構築（confidence + lineage 付き）');
  console.log(`   Objects: ${store.getObjects().length} / Links: ${countLinks(store)}`);
  for (const o of store.getObjects()) {
    if (o.kind === 'Person') continue;
    console.log(`   - ${o.kind}: ${summary(o.props)}  (conf ${o.meta.confidence}, src ${o.meta.sources[0]?.source})`);
  }

  // (3) Sense→Model→Act の一周（flowing シナリオを取り込み）
  applyScenario(store, 'flowing', nowMs);
  console.log('\n【3】Sense: 出荷を取り込み → Model: AsIs を算出 → Act: 提案（承認前の台帳へ）');
  const brief = await runCycle(store, llm, nowMs);
  console.log('\n' + indent(brief.text) + '\n');

  // (4) Motivation State Machine のデモ：同じ人・違う状況で姿勢が変わる（差別化の核）
  console.log('\n【4】Motivation State Machine（同じ人・違う状況 → 姿勢が変わる / docs/06 §4）');
  const scenarios: Scenario[] = ['flowing', 'coasting', 'drifting', 'stalled', 'burnt'];
  for (const sc of scenarios) {
    const s = new InMemoryStore(); // 使い捨て（永続化しない）
    await seedPersona(s, llm);
    applyScenario(s, sc, nowMs);
    const b = await runCycle(s, llm, nowMs);
    console.log(`\n   ● 状況=${sc.padEnd(8)} → 状態=${b.asis.motivationState.padEnd(8)} / 姿勢=${b.asis.posture}`);
    console.log(`     一言   : ${b.headline}`);
    console.log(`     今日の一手: ${b.oneThing ? describeShort(b.oneThing) : '(なし)'}`);
  }

  console.log('\n' + '='.repeat(64));
  console.log('一周完了。自己モデルは data/ontology.json に永続化。');
  console.log('  次: `npm run brief`（保存済み状態でブリーフ再生成） / `npm run reset`');
  console.log('  実 LLM: ANTHROPIC_API_KEY を設定すると Claude が抽出・言い換えを担当。');
  console.log('='.repeat(64));
}

// ---- 小道具 ----
function countLinks(store: InMemoryStore): number {
  return store.getObjects().reduce((n, o) => n + store.linksFrom(o.id).length, 0);
}
function summary(props: Record<string, unknown>): string {
  return String(
    props.title ?? props.narrative ?? props.statement ?? props.name ?? JSON.stringify(props),
  ).slice(0, 44);
}
function indent(s: string): string {
  return s.split('\n').map((l) => '   ' + l).join('\n');
}
function describeShort(a: ProposedAction): string {
  if (a.kind === 'commit.request') return '今週のコミットを宣言';
  if (a.kind === 'calendar.create_focus_block') return `${a.payload.minutes}分の集中ブロックを予約`;
  if (a.kind === 'nudge.send') return String(a.payload.text);
  if (a.kind === 'resource.enqueue') return String(a.payload.text);
  return a.kind;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
