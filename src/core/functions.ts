// Functions — AsIs を数値化し、Motivation State を推定し、次の一手を並べる。
// docs/03 §4（Functions）と docs/06 §4（Motivation State Machine）に対応。

import type { OntologyStore } from './store.ts';
import type {
  AsIsSnapshot,
  MotivationState,
  OntologyObject,
  ProposedAction,
} from '../ontology/types.ts';
import { POSTURE_BY_STATE } from '../ontology/types.ts';

const DAY = 86_400_000;
const daysBetween = (a: number, b: number) => Math.floor((a - b) / DAY);

// ---- gap_score(goal): 1 - progress ----
export function gapScore(goal: OntologyObject): number {
  const progress = Number(goal.props.progress ?? 0);
  return Math.max(0, Math.min(1, 1 - progress));
}

// ---- momentum: 出荷(ShipEvent)から勢いを測る ----
export function momentum(store: OntologyStore, nowMs: number) {
  const ships = store
    .getObjects('ShipEvent')
    .map((s) => new Date(String(s.props.at)).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => b - a);

  const shipsLast7 = ships.filter((t) => nowMs - t <= 7 * DAY).length;
  const shipsPrev7 = ships.filter((t) => nowMs - t > 7 * DAY && nowMs - t <= 14 * DAY).length;

  // 連続週: 直近から遡り、出荷のある週が続く数
  let streakWeeks = 0;
  for (let w = 0; w < 12; w++) {
    const hi = nowMs - w * 7 * DAY;
    const lo = hi - 7 * DAY;
    const hit = ships.some((t) => t <= hi && t > lo);
    if (hit) streakWeeks++;
    else break;
  }
  return { shipsLast7, shipsPrev7, streakWeeks, lastShipMs: ships[0] };
}

// ---- drift_risk(goal): 出荷停滞 + コミット未達 で上昇 ----
export function driftRisk(store: OntologyStore, nowMs: number): number {
  const m = momentum(store, nowMs);
  const daysSinceShip = m.lastShipMs ? daysBetween(nowMs, m.lastShipMs) : 30;
  const stalledShip = Math.min(1, daysSinceShip / 10); // 10日出荷なしで最大

  const openCommits = store.getCommits().filter((c) => c.status === 'open');
  const missed = store.getCommits().filter((c) => c.status === 'missed').length;
  const commitPressure = Math.min(1, (openCommits.length > 0 ? 0.3 : 0) + missed * 0.25);

  return Math.max(0, Math.min(1, 0.6 * stalledShip + 0.4 * commitPressure));
}

// ---- burnout_signal: 低エネルギー・ネガ気分の State から ----
export function burnoutSignal(store: OntologyStore, nowMs: number): number {
  const recent = store
    .getObjects('State')
    .filter((s) => nowMs - new Date(String(s.props.at)).getTime() <= 7 * DAY);
  if (recent.length === 0) return 0;
  const energies = recent
    .map((s) => Number(s.props.energy))
    .filter((n) => !Number.isNaN(n)); // 0..1
  if (energies.length === 0) return 0;
  const avg = energies.reduce((a, b) => a + b, 0) / energies.length;
  return Math.max(0, Math.min(1, 1 - avg)); // 低エネルギーほど高
}

// ---- Motivation State Machine（順序が優先度） ----
export function motivationState(store: OntologyStore, nowMs: number): MotivationState {
  const lastOpen = store.lastOpenedAt();
  const daysSinceOpen = lastOpen ? daysBetween(nowMs, new Date(lastOpen).getTime()) : 99;
  const m = momentum(store, nowMs);
  const drift = driftRisk(store, nowMs);
  const burn = burnoutSignal(store, nowMs);

  if (daysSinceOpen >= 3) return 'Stalled'; // 木曜の夜フェイルセーフ対象
  if (burn >= 0.6) return 'Burnt';
  if (m.shipsLast7 >= 3) return 'Flowing';
  if (drift >= 0.5) return 'Drifting';
  return 'Coasting';
}

// ---- AsIs スナップショット ----
export function computeAsIs(store: OntologyStore, nowMs: number): AsIsSnapshot {
  const m = momentum(store, nowMs);
  const goals = store.getObjects('Goal');
  const ranked = goals
    .map((g) => ({ goalId: g.id, title: String(g.props.title ?? 'Goal'), gap: gapScore(g) }))
    .sort((a, b) => b.gap - a.gap);
  const lastOpen = store.lastOpenedAt();
  const state = motivationState(store, nowMs);

  return {
    atISO: new Date(nowMs).toISOString(),
    momentum: {
      shipsLast7: m.shipsLast7,
      shipsPrev7: m.shipsPrev7,
      streakWeeks: m.streakWeeks,
    },
    topGap: ranked[0],
    driftRisk: Number(driftRisk(store, nowMs).toFixed(2)),
    burnout: Number(burnoutSignal(store, nowMs).toFixed(2)),
    daysSinceOpen: lastOpen ? daysBetween(nowMs, new Date(lastOpen).getTime()) : 99,
    motivationState: state,
    posture: POSTURE_BY_STATE[state],
  };
}

// ---- next_best_action: 候補を生成しスコアで並べる ----
// score = w1*期待Gap縮小 + w2*実現可能性 + w3*価値観整合 - w4*詰め込み
type Candidate = Omit<ProposedAction, 'id' | 'proposedAt' | 'state'>;

export function nextBestActions(store: OntologyStore, nowMs: number): Candidate[] {
  const asis = computeAsIs(store, nowMs);
  const candidates: Candidate[] = [];
  const capacity = 1 - asis.burnout; // 消耗しているほど実現可能性は低い

  const topGoal = asis.topGap;
  const state = asis.motivationState;
  const value = store.getObjects('Value')[0];
  const thisWeekCommit = store
    .getCommits()
    .some((c) => c.status === 'open' && daysBetween(nowMs, new Date(c.weekStart).getTime()) < 7);

  // 状態別のコア提案（各状態が正しい姿勢を先頭に出すよう score を設計）
  if (state === 'Stalled' || state === 'Burnt') {
    // フェイルセーフ / Protect: ハードルを最小化（Tiny Habits）。詰めない。
    candidates.push({
      kind: 'nudge.send',
      payload: { style: 'tiny', text: '今日は1行だけ。何に詰まってる？（進めなくてOK）' },
      rationale: [`状態=${state}`, '要求を最小化して再入場を作る(docs/06 M4)'],
      score: 0.95,
    });
  } else if (state === 'Drifting') {
    // Re-anchor + Shrink: なぜ始めたか(価値観)に戻り、行動を小さく割る。
    candidates.push({
      kind: 'nudge.send',
      payload: {
        style: 'reanchor',
        text: `「${value?.props.statement ?? '出荷し続ける'}」— これを思い出して、今日は25分だけ小さく動こう`,
      },
      rationale: [`状態=Drifting (drift risk ${asis.driftRisk})`, '価値観に再接続し行動を小さく(docs/06 M4)'],
      score: 0.9,
    });
    if (topGoal) {
      candidates.push({
        kind: 'calendar.create_focus_block',
        payload: { minutes: 25, goalId: topGoal.goalId, title: `小さく再開: ${topGoal.title}` },
        rationale: [`最大Gap=「${topGoal.title}」(gap=${topGoal.gap.toFixed(2)})`],
        score: 0.6,
      });
    }
  } else if (topGoal) {
    // Flowing / Coasting: 集中ブロックを予定化して top-gap を進める
    candidates.push({
      kind: 'calendar.create_focus_block',
      payload: { minutes: 50, goalId: topGoal.goalId, title: `出荷: ${topGoal.title}` },
      rationale: [`最大Gap=「${topGoal.title}」(gap=${topGoal.gap.toFixed(2)})`, `capacity=${capacity.toFixed(2)}`],
      score: 0.5 * topGoal.gap + 0.4 * capacity + 0.2,
    });
  }

  // アカウンタビリティ（M2）: 余力がある状態(Flowing/Coasting)でのみコミットを促す。詰めない。
  if (!thisWeekCommit && (state === 'Flowing' || state === 'Coasting')) {
    candidates.push({
      kind: 'commit.request',
      payload: { prompt: '来週、出荷する“たった1つ”は？' },
      rationale: ['今週の Weekly Commit が未設定', 'アカウンタビリティ・ループ(docs/06 M2)'],
      score: state === 'Flowing' ? 0.7 : 0.85,
    });
  }

  // 3) Flowing なら勝ちを外に出す（M3 産出物 = 獲得ループ）
  if (asis.motivationState === 'Flowing') {
    candidates.push({
      kind: 'resource.enqueue',
      payload: { kind: 'build-in-public-draft', text: `今週の出荷 ${asis.momentum.shipsLast7} 件を weekly update に。` },
      rationale: ['状態=Flowing: 勢いを可視化し外部化', 'M3 産出物→獲得ループ'],
      score: 0.6,
    });
  }

  // 4) スキル Gap があればリソース提案（Librarian の芽）
  const skillGap = store
    .getObjects('Skill')
    .find((s) => Number(s.props.currentLevel ?? 0) < Number(s.props.targetLevel ?? 0));
  if (skillGap && asis.motivationState !== 'Stalled') {
    candidates.push({
      kind: 'resource.enqueue',
      payload: { kind: 'learning', skill: skillGap.props.name, text: `「${skillGap.props.name}」を伸ばす教材を1つ` },
      rationale: [`スキル「${skillGap.props.name}」が目標水準に未達`],
      score: 0.35,
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}
