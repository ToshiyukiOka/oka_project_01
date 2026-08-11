// Personal Operational Ontology — 型定義
// docs/03_ontology_schema.md に対応。Objects / Links / Actions / Functions の名詞・関係を型で表す。
// すべての事実(Object/Link)は confidence + lineage(sources) を持つ。

// ---- lineage（データ系譜: どのソース由来の事実か） ----
export interface LineageRef {
  source: string; // 'interview' | 'gcal' | 'github' | 'notion' | 'derived' ...
  ref?: string; // 元レコードの識別子
  at: string; // ISO8601
}

export type ObjectStatus = 'active' | 'superseded' | 'forgotten';

export interface FactMeta {
  confidence: number; // 0.0–1.0
  sources: LineageRef[];
  status: ObjectStatus;
  createdAt: string;
  updatedAt: string;
  validFrom?: string;
  validTo?: string;
}

// ---- Objects ----
export type ObjectKind =
  | 'Person'
  | 'Value'
  | 'IdealSelf'
  | 'Theme'
  | 'Goal'
  | 'Skill'
  | 'Habit'
  | 'Task'
  | 'ShipEvent' // インディーハッカーの「出荷」= momentum の一次データ
  | 'State' // 気分・エネルギー等
  | 'Reflection'
  | 'Resource'
  | 'Relationship'
  | 'Gap';

export interface OntologyObject {
  id: string;
  kind: ObjectKind;
  props: Record<string, unknown>;
  meta: FactMeta;
}

// ---- Links（有向関係） ----
export type LinkKind =
  | 'expressed_as' // IdealSelf -> Theme
  | 'contains' // Theme -> Goal
  | 'requires' // Goal -> Skill
  | 'contributes_to' // Habit/ShipEvent -> Goal
  | 'advances' // Task -> Goal
  | 'develops' // Resource -> Skill
  | 'motivates' // Value -> Goal
  | 'measured_for' // Gap -> Goal
  | 'about'; // Reflection -> Goal/Project

export interface OntologyLink {
  id: string;
  from: string;
  to: string;
  kind: LinkKind;
  meta: Pick<FactMeta, 'confidence' | 'sources' | 'createdAt'>;
}

// ---- Weekly Commit（アカウンタビリティ・ループ / docs/06 M2） ----
export interface WeeklyCommit {
  id: string;
  weekStart: string; // ISO date (週初)
  statement: string; // 「来週出荷するたった1つ」本人の言葉
  goalId?: string;
  status: 'open' | 'done' | 'missed';
  shared: boolean;
  createdAt: string;
}

// ---- Actions（書き戻し提案の台帳。外部作用は承認フローを通す） ----
export type ActionKind =
  | 'calendar.create_focus_block'
  | 'task.create'
  | 'resource.enqueue'
  | 'commit.request'
  | 'nudge.send'
  | 'reflection.log';

export interface ProposedAction {
  id: string;
  kind: ActionKind;
  payload: Record<string, unknown>;
  rationale: string[]; // 説明可能性: どのオントロジー事実に基づくか
  score: number;
  state: 'proposed' | 'approved' | 'rejected' | 'executed';
  proposedAt: string;
}

// ---- Motivation State Machine（docs/06 §4） ----
export type MotivationState =
  | 'Flowing'
  | 'Coasting'
  | 'Drifting'
  | 'Stalled'
  | 'Burnt';

export type Posture =
  | 'Celebrate+Stretch'
  | 'Focus'
  | 'Re-anchor+Shrink'
  | 'Thursday-night failsafe'
  | 'Protect';

export const POSTURE_BY_STATE: Record<MotivationState, Posture> = {
  Flowing: 'Celebrate+Stretch',
  Coasting: 'Focus',
  Drifting: 'Re-anchor+Shrink',
  Stalled: 'Thursday-night failsafe',
  Burnt: 'Protect',
};

// ---- AsIs スナップショット（Analyst の出力 / Functions の集約） ----
export interface AsIsSnapshot {
  atISO: string;
  momentum: {
    shipsLast7: number;
    shipsPrev7: number;
    streakWeeks: number;
  };
  topGap?: { goalId: string; title: string; gap: number };
  driftRisk: number; // 0–1
  burnout: number; // 0–1
  daysSinceOpen: number;
  motivationState: MotivationState;
  posture: Posture;
}
