// Interviewer — 5問オンボーディングで自己モデルの空白を埋める（能動学習の芽）。
// コネクタ接続は必須にしない。まず対話だけで AsIs + 最初の ToBe を作る（docs/05 §3 ゼロデータで価値）。

import type { OntologyStore } from '../core/store.ts';
import type { LLM } from './llm.ts';
import type { LineageRef } from '../ontology/types.ts';

export interface InterviewAnswers {
  idealSelf: string; // なりたい姿
  theme: string; // 今のテーマ（四半期）
  goal: string; // 達成したい具体ゴール
  value: string; // 大事にしている価値観 / 行動指針
  skillGap: string; // 今一番伸ばしたいスキル
}

export const INTERVIEW_QUESTIONS: Array<{ key: keyof InterviewAnswers; q: string }> = [
  { key: 'idealSelf', q: '3〜6ヶ月後、どんな自分になっていたい？（ありたい姿を一言で）' },
  { key: 'theme', q: 'いまの自分のテーマを1つ挙げると？' },
  { key: 'goal', q: 'その中で「これを達成したい」という具体的なゴールは？' },
  { key: 'value', q: '作る／進める上で、大事にしている価値観・行動指針は？' },
  { key: 'skillGap', q: 'いま一番伸ばしたいスキルは？' },
];

// 対話から得た事実をオントロジーへ反映（confidence + lineage 付き）。
export async function runInterview(
  store: OntologyStore,
  llm: LLM,
  answers: InterviewAnswers,
): Promise<void> {
  const src: LineageRef[] = [{ source: 'interview', at: new Date().toISOString() }];

  // 実 LLM がある時は言い換え・正規化、無い時はそのまま（Stub）。
  const norm = async (text: string) =>
    llm.kind === 'claude'
      ? llm.complete(
          '入力を、簡潔で行動に接続しやすい一文に正規化して返す。余計な語を足さない。',
          text,
        )
      : text.trim();

  const ideal = store.addObject('IdealSelf', { narrative: await norm(answers.idealSelf) }, { confidence: 0.7, sources: src });
  const theme = store.addObject('Theme', { title: await norm(answers.theme) }, { confidence: 0.7, sources: src });
  const goal = store.addObject(
    'Goal',
    { title: await norm(answers.goal), progress: 0, type: 'ship' },
    { confidence: 0.7, sources: src },
  );
  const value = store.addObject('Value', { statement: await norm(answers.value) }, { confidence: 0.7, sources: src });
  const skill = store.addObject(
    'Skill',
    { name: await norm(answers.skillGap), currentLevel: 2, targetLevel: 4 },
    { confidence: 0.5, sources: src },
  );

  // リンク: IdealSelf -expressed_as-> Theme -contains-> Goal -requires-> Skill, Value -motivates-> Goal
  store.addLink(ideal.id, theme.id, 'expressed_as', { sources: src });
  store.addLink(theme.id, goal.id, 'contains', { sources: src });
  store.addLink(goal.id, skill.id, 'requires', { sources: src });
  store.addLink(value.id, goal.id, 'motivates', { sources: src });
}
