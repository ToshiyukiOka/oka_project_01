-- Personal Brain OS — 本番ターゲットのスキーマ（Postgres 中心 + pgGraph/AGE）
-- 歩くスケルトン(src/)はローカルの InMemoryStore で動くが、本番はこのスキーマに載せ替える。
-- 方針: リレーショナルに素直に持ち、グラフ探索が要る所だけ AGE(Apache Graph Extension) を併用。

-- ============================================================
-- 拡張
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;   -- pgvector: エピソード記憶の意味検索
-- CREATE EXTENSION IF NOT EXISTS age;    -- pgGraph(AGE): リンク探索（有効化は運用判断）
-- LOAD 'age'; SET search_path = ag_catalog, "$user", public;

-- ============================================================
-- ① ユーザー（ローカルファースト前提。1端末=1ユーザーでも成立）
-- ============================================================
CREATE TABLE IF NOT EXISTS app_user (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  handle        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_opened_at TIMESTAMPTZ                    -- Motivation State Machine が参照
);

-- ============================================================
-- ② オントロジー: Objects（すべての事実は confidence + lineage を持つ）
-- ============================================================
CREATE TABLE IF NOT EXISTS onto_object (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                    -- Person/Value/IdealSelf/Theme/Goal/Skill/Habit/Task/ShipEvent/State/Reflection/Resource/Relationship/Gap
  props       JSONB NOT NULL DEFAULT '{}',      -- 種別ごとのプロパティ
  confidence  REAL NOT NULL DEFAULT 0.5,        -- 0.0–1.0
  sources     JSONB NOT NULL DEFAULT '[]',      -- lineage: [{source, ref, at}]
  status      TEXT NOT NULL DEFAULT 'active',   -- active/superseded/forgotten
  valid_from  TIMESTAMPTZ,
  valid_to    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_object_user_kind ON onto_object(user_id, kind) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_object_props ON onto_object USING gin(props);

-- ============================================================
-- ③ オントロジー: Links（有向。介入立案はここを辿る）
-- ============================================================
CREATE TABLE IF NOT EXISTS onto_link (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  from_id     UUID NOT NULL REFERENCES onto_object(id) ON DELETE CASCADE,
  to_id       UUID NOT NULL REFERENCES onto_object(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                    -- expressed_as/contains/requires/contributes_to/advances/develops/motivates/measured_for/about
  confidence  REAL NOT NULL DEFAULT 0.5,
  sources     JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_link_from ON onto_link(from_id, kind);
CREATE INDEX IF NOT EXISTS idx_link_to   ON onto_link(to_id, kind);

-- ============================================================
-- ④ エピソード記憶（時系列 + ベクトル）
-- ============================================================
CREATE TABLE IF NOT EXISTS episode (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                    -- interview/reflection/event/chat/nudge
  text        TEXT NOT NULL,
  embedding   vector(1536),                     -- pgvector
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sources     JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_episode_time ON episode(user_id, occurred_at DESC);

-- ============================================================
-- ⑤ Actions（書き戻し提案とその承認・結果）— Human-in-the-loop の台帳
-- ============================================================
CREATE TABLE IF NOT EXISTS action_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  action_kind TEXT NOT NULL,                    -- calendar.create_focus_block / task.create / resource.enqueue / nudge.send ...
  payload     JSONB NOT NULL DEFAULT '{}',
  rationale   JSONB NOT NULL DEFAULT '[]',      -- 提案根拠(オントロジー事実の参照) = 説明可能性
  state       TEXT NOT NULL DEFAULT 'proposed', -- proposed/approved/rejected/executed
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- ============================================================
-- ⑥ Weekly Commit（アカウンタビリティ・ループの中核 / docs/06 M2）
-- ============================================================
CREATE TABLE IF NOT EXISTS weekly_commit (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  week_start  DATE NOT NULL,
  statement   TEXT NOT NULL,                    -- 「来週、出荷するたった1つ」本人の言葉
  goal_id     UUID REFERENCES onto_object(id),
  status      TEXT NOT NULL DEFAULT 'open',     -- open/done/missed
  shared      BOOLEAN NOT NULL DEFAULT false,   -- build-in-public に外部化したか
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, week_start)
);
