// デモ用シード。インディーハッカーのペルソナと、Motivation State を作り分けるシナリオ。

import type { OntologyStore } from '../core/store.ts';
import type { LLM } from '../agents/llm.ts';
import { runInterview, type InterviewAnswers } from '../agents/interviewer.ts';
import { ingestShipEvent, ingestState } from '../core/loop.ts';

const DAY = 86_400_000;
const iso = (nowMs: number, daysAgo: number) => new Date(nowMs - daysAgo * DAY).toISOString();

// インディーハッカーの模擬回答（本来はユーザーが入力）
export const INDIE_HACKER_ANSWERS: InterviewAnswers = {
  idealSelf: '自分のSaaSで生活できる独立した作り手',
  theme: '最初の有料ユーザーを獲得する',
  goal: 'v1 を公開して初課金を得る',
  value: '完璧より出荷。毎週なにかを世に出す',
  skillGap: 'ローンチとマーケティング（作るのは得意、売るのが苦手）',
};

export type Scenario = 'flowing' | 'coasting' | 'drifting' | 'stalled' | 'burnt';

export async function seedPersona(store: OntologyStore, llm: LLM): Promise<void> {
  store.addObject('Person', { handle: 'indie_hacker', personas: ['builder'] }, { confidence: 1 });
  await runInterview(store, llm, INDIE_HACKER_ANSWERS);
}

// シナリオごとに出荷・状態・最終オープンを作り分ける
export function applyScenario(store: OntologyStore, scenario: Scenario, nowMs: number): void {
  switch (scenario) {
    case 'flowing': // 直近よく出荷、開いている
      store.markOpened(iso(nowMs, 0));
      ingestShipEvent(store, 'ランディングページ公開', iso(nowMs, 5));
      ingestShipEvent(store, '決済連携を実装', iso(nowMs, 3));
      ingestShipEvent(store, 'ベータ招待を送付', iso(nowMs, 1));
      ingestState(store, 0.8, 'good', iso(nowMs, 1));
      break;
    case 'coasting': // ぼちぼち、開いている
      store.markOpened(iso(nowMs, 1));
      ingestShipEvent(store, 'バグ修正', iso(nowMs, 4));
      ingestState(store, 0.6, 'ok', iso(nowMs, 1));
      break;
    case 'drifting': // 10日出荷なし + コミット未達、開いてはいる
      store.markOpened(iso(nowMs, 1));
      ingestShipEvent(store, '初期プロトタイプ', iso(nowMs, 12));
      store.addCommit({ weekStart: iso(nowMs, 8).slice(0, 10), statement: 'ベータを出す', status: 'missed', shared: false });
      ingestState(store, 0.5, 'meh', iso(nowMs, 2));
      break;
    case 'stalled': // 数日開いていない（木曜の夜フェイルセーフ対象）
      store.markOpened(iso(nowMs, 5));
      ingestShipEvent(store, 'READMEを書いた', iso(nowMs, 9));
      break;
    case 'burnt': // 低エネルギーが続く
      store.markOpened(iso(nowMs, 1));
      ingestShipEvent(store, '小さな改善', iso(nowMs, 3));
      ingestState(store, 0.2, 'tired', iso(nowMs, 1));
      ingestState(store, 0.25, 'tired', iso(nowMs, 2));
      break;
  }
}
