# 04. ロードマップ & MVP スコープ

「30 分で"理解されている"体験 → 週次で伴走 → 自己モデルが育つ」を最短で検証する順序で組む。

---

## フェーズ 0: コンセプト検証（Wizard-of-Oz / 手動）
- 目的: 「Digital Twin コーチ」に価値があるか、技術投資前に検証。
- 手法: 数名のユーザーで、データを手で集め、人＋LLM で Weekly Review を運用。
- 判断: 「来週も続けたい」「自分を理解されている感覚」が出るか。

## フェーズ 1: MVP（"Thin Slice"）
**目標: 1〜2 コネクタ + Interview で AsIs を出し、1 つのゴールに週次で伴走する。**

- ① OS: Google カレンダー + Notion(or Slack) 接続、Data Vault、Consent、Lineage 最小。
- ② Ontology: コア Objects（Value/Goal/Theme/Skill/Habit/Task/State/Reflection）+ 主要 Links。Postgres + pgvector に実装。
- ③ Agent: Orchestrator + Coach/Planner/Analyst/Interviewer + 主要 Actions（calendar/task/nudge/reflection/ontology.write_fact）。
- ④ Experience: オンボーディング、AsIs スナップショット、Morning Brief、Weekly Review、チャット。
- 除外（後回し）: Connector(対人紹介)、音声、複雑な SNS 解析、ローカルファースト Vault。

**MVP の成功条件**: 30 分以内に AsIs が提示でき、4 週継続で Gap 縮小と継続意向が観測できる。

## フェーズ 2: 自己モデルの深化と拡張
- コネクタ拡充（SNS / ブログ / プロフィール / Deep Research 取り込み、Entity Resolution 強化）。
- Librarian（リソース推薦）と Connector（人・機会の接続）を追加。
- 手続き記憶の高度化（ナッジ頻度・励まし方の個人最適）。
- AsIs ダッシュボードの充実、自己モデルの閲覧・修正 UX。

## フェーズ 3: 信頼・スケール
- プライバシー強化（初期は後回しにした E2E / セルフホスト Vault の厳密化、機微データのモデルルーティング）。
- 説明可能性 UI（なぜこの提案か）の全面化。
- 収益モデル検証（→ `05_pm_review.md` の結論を反映）。
- ※ 組織版とのコア共通化は**やらない**（個人版として独立最適化）。

---

## 最初の 2 週間で作る「歩くスケルトン」（技術的な着手順）

1. **リポジトリ / モノレポ雛形**（apps: web, mobile / packages: ontology, agents, connectors, core）。
2. **オントロジー型定義**（Objects/Links/Actions/Functions を TypeScript 型 + Postgres スキーマで）。
3. **1 コネクタ（Google カレンダー）** の取り込み → 正規化 → オントロジー反映（Lineage 付き）。
4. **Interviewer + ontology.write_fact**: 5 問オンボーディングで Value/Goal/Theme を埋める。
5. **Analyst の Functions**（gap_score / next_best_action の素朴版）。
6. **Morning Brief 生成 + calendar.create_focus_block**（承認フロー付き）。
7. **Weekly Review** の対話フロー（Coach）。

> この 7 ステップで「取り込み → 自己モデル → AsIs → 介入 → 伴走」の閉ループが最小構成で一周する。

---

## 決定事項（2026-08 時点）
- [x] ホスティング: **ローカルファースト**（プライバシーの作り込みは後回し）
- [x] オントロジー物理表現: **Postgres 中心 + 必要に応じ pgGraph（AGE 等）**
- [x] 組織版との共通化: **しない**（独立最適化）

## 次アクション（この仕様のたたき台に対して）
- [ ] **[最優先] ウェッジ（初期セグメントと1つの尖った提供価値）を1つに絞る** → `05_pm_review.md`
- [ ] MVP のコネクタを 1〜2 個に確定（コールドスタート戦略と一体で）
- [ ] オントロジーのコア Object セットをレビュー・確定
- [ ] フェーズ0（Wizard-of-Oz）を自分自身で回してみる
