// Loop — Sense → Model → Plan → Act → Learn の薄い一周（docs/02 §3.3）。
// Model/Plan/Act の中身は functions.ts と coach.ts に委譲。ここは配線だけ。

import type { OntologyStore } from './store.ts';
import type { LLM } from '../agents/llm.ts';
import type { LineageRef } from '../ontology/types.ts';
import { morningBrief, type Brief } from '../agents/coach.ts';

// ---- Sense: シグナルをオントロジーに取り込む ----
export function ingestShipEvent(store: OntologyStore, title: string, atISO: string, source = 'github') {
  const src: LineageRef[] = [{ source, at: atISO }];
  const ship = store.addObject('ShipEvent', { title, at: atISO }, { confidence: 0.95, sources: src });
  // 出荷は最も距離の大きい Goal に貢献したとみなす（簡略）。本番は関連付けを推論。
  const goal = store
    .getObjects('Goal')
    .sort((a, b) => Number(b.props.progress ?? 0) - Number(a.props.progress ?? 0))[0];
  if (goal) {
    store.addLink(ship.id, goal.id, 'contributes_to', { sources: src });
    const p = Math.min(1, Number(goal.props.progress ?? 0) + 0.15); // 1出荷=+0.15（簡略）
    store.updateObject(goal.id, { progress: p });
  }
  return ship;
}

export function ingestState(store: OntologyStore, energy: number, mood: string, atISO: string) {
  return store.addObject('State', { energy, mood, at: atISO }, {
    confidence: 0.9,
    sources: [{ source: 'checkin', at: atISO }],
  });
}

// ---- 1周: Model→Plan→Act(propose) をまとめて Brief を返す ----
export async function runCycle(store: OntologyStore, llm: LLM, nowMs: number): Promise<Brief> {
  const brief = await morningBrief(store, llm, nowMs);
  store.save();
  return brief;
}
