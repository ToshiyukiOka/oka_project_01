// Coach — Motivation State に応じて「姿勢(posture)」を変えて Morning Brief を組む。
// 同じ状況でも状態が違えば言葉が変わる（docs/06 §4）。

import type { OntologyStore } from '../core/store.ts';
import type { LLM } from './llm.ts';
import type { AsIsSnapshot, ProposedAction } from '../ontology/types.ts';
import { computeAsIs, nextBestActions } from '../core/functions.ts';

// 状態別の一言（フェイルセーフ／Protect は詰めない・恥をかかせない）
const POSTURE_LINE: Record<AsIsSnapshot['motivationState'], string> = {
  Flowing: '乗ってる。勝ちを外に出して、ほんの少しだけ bar を上げよう。',
  Coasting: '悪くない流れ。今日の“たった1つ”に集中しよう。',
  Drifting: '少し逸れ気味。なぜ始めたか(価値観)に戻って、行動を小さく割ろう。',
  Stalled: 'しばらく空いたね。責めない。今日は1行だけでいい。',
  Burnt: '消耗してる。休んでいい。目標は一時的に小さくしよう。',
};

export interface Brief {
  asis: AsIsSnapshot;
  headline: string;
  oneThing?: ProposedAction;
  actions: ProposedAction[];
  text: string;
}

export async function morningBrief(store: OntologyStore, llm: LLM, nowMs: number): Promise<Brief> {
  const asis = computeAsIs(store, nowMs);
  const candidates = nextBestActions(store, nowMs);
  const actions = candidates.map((c) => store.proposeAction(c)); // 台帳に提案として記録（承認前）
  const oneThing = actions[0];

  const streak = asis.momentum.streakWeeks;
  const shipsWow =
    asis.momentum.shipsLast7 - asis.momentum.shipsPrev7 >= 0
      ? `+${asis.momentum.shipsLast7 - asis.momentum.shipsPrev7}`
      : `${asis.momentum.shipsLast7 - asis.momentum.shipsPrev7}`;

  const headline = `${POSTURE_LINE[asis.motivationState]}`;

  const lines: string[] = [];
  lines.push(`☀️  Morning Brief — ${new Date(nowMs).toLocaleDateString('ja-JP')}`);
  lines.push(`   状態: ${asis.motivationState}  / 姿勢: ${asis.posture}`);
  lines.push('');
  lines.push(`   ${headline}`);
  lines.push('');
  lines.push(`   📈 Momentum: 今週の出荷 ${asis.momentum.shipsLast7} 件 (前週比 ${shipsWow}) / ship streak ${streak} 週`);
  if (asis.topGap) lines.push(`   🎯 最大の距離: 「${asis.topGap.title}」 (gap ${asis.topGap.gap.toFixed(2)})`);
  if (asis.driftRisk >= 0.5) lines.push(`   ⚠️  drift risk ${asis.driftRisk} — 早めに小さく動こう`);
  if (asis.burnout >= 0.4) lines.push(`   🫗 burnout signal ${asis.burnout} — 無理しない`);
  lines.push('');
  if (oneThing) {
    lines.push(`   ✅ 今日の“たった1つ”: ${describeAction(oneThing)}`);
    lines.push(`      └ なぜ: ${oneThing.rationale.join(' / ')}`); // 説明可能性
  }
  const rest = actions.slice(1, 3);
  if (rest.length) {
    lines.push('');
    lines.push('   そのほかの候補:');
    for (const a of rest) lines.push(`     - ${describeAction(a)}`);
  }

  let text = lines.join('\n');

  // 実 LLM があれば、姿勢を保ったまま人肌の一言に言い換える（任意）。
  if (llm.kind === 'claude') {
    const warm = await llm.complete(
      `あなたはインディーハッカーに伴走するコーチ。姿勢=${asis.posture}。詰めない・依存させない・自律を育てる。1〜2文で。`,
      headline,
    );
    text = text.replace(headline, warm);
  }

  return { asis, headline, oneThing, actions, text };
}

function describeAction(a: ProposedAction): string {
  switch (a.kind) {
    case 'commit.request':
      return `今週のコミットを宣言（${a.payload.prompt}）`;
    case 'calendar.create_focus_block':
      return `${a.payload.minutes}分の集中ブロックを予約 — ${a.payload.title}`;
    case 'nudge.send':
      return `${a.payload.text}`;
    case 'resource.enqueue':
      return `${a.payload.text}`;
    case 'reflection.log':
      return '振り返りを1つ記録';
    case 'task.create':
      return `タスク作成: ${a.payload.title}`;
    default:
      return a.kind;
  }
}
