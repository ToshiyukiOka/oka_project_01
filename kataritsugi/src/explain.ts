// 「なぜ語り継ぐべきか」の解説。docs/01 §6。
// 二層構成:
//   1) データの証言 — グラフから決定的に生成（誰が・何世代が・どの畑が歌い継いだか）。捏造の余地がない層
//   2) 文脈の解説   — 作品の文化的・音楽的な意味。seed/notes.json の監修済みノート、
//                      無ければ LLM（ANTHROPIC_API_KEY があれば）に「1) の証拠だけを根拠に」書かせる

import type { Dataset, Ranked } from './types.ts';
import type { Graph } from './graph.ts';
import { FIELD_LABEL, crossover, fieldOf } from './legacy.ts';
import type { LLM } from '../../src/agents/llm.ts';

export interface Explanation {
  evidence: string[];
  context?: string;
  contextSource?: 'notes' | 'llm';
}

const credit = (r: Ranked) => {
  const w = r.work;
  const writers = [...new Set([...w.lyricist, ...w.composer])].join('・');
  const orig = w.original.length ? w.original.join('・') : '（原唱者なし）';
  return `${w.year}年 ${orig}（作: ${writers}）`;
};

export function evidenceLines(ds: Dataset, g: Graph, r: Ranked): string[] {
  const lines: string[] = [];
  if (r.coverCount === 0) return ['証拠付きのカバーが未収集。'];

  // 歌い継いだ人数と、票の大きい歌い手
  const top = r.voters.slice(0, 3);
  const median = medianAuthority(r);
  const heavy = top.filter((v) => v.authority > 2 * median).map((v) => v.artist);
  lines.push(
    `セルフカバーを除き ${r.coverCount} 組が歌い直した（証拠付き）。票の重い歌い手: ${top.map((v) => v.artist).join('、')}` +
      (heavy.length ? `（${heavy.join('・')} は自身の曲も他者に歌い継がれている“歌い手の歌い手”）` : ''),
  );

  // 世代
  if (r.generations.length > 0) {
    lines.push(
      `原曲（${r.work.year}年）より後にデビューした ${r.generations.map((d) => `${d}年代`).join('・')} の歌い手が拾い上げている（${r.generations.length} 世代）。`,
    );
  } else {
    lines.push('原曲より後の世代による証拠付きカバーは、現データでは未確認。');
  }

  // 越境
  const x = crossover(ds, g, r.work);
  const fields = [...x.fields.keys()].map((f) => FIELD_LABEL[f]);
  if (fields.length > 1) {
    const foreigners = (g.coversByWork.get(r.work.id) ?? [])
      .filter((e) => fieldOf(ds, g, e.artist, e.cover.artist) === 'foreign')
      .map((e) => e.cover.artist);
    lines.push(
      `歌い手の畑は ${fields.join('／')}（実効 ${x.effective.toFixed(1)} ジャンル）` +
        (foreigners.length ? `。国境を越えたカバー: ${foreigners.slice(0, 4).join('、')}` : '') +
        '。',
    );
  }
  if (r.burstMultiplier < 1) {
    lines.push(`カバーが短期間に集中しており、単発の流行の可能性として ${(100 * (1 - r.burstMultiplier)).toFixed(0)}% 減点。`);
  }
  return lines;
}

function medianAuthority(r: Ranked) {
  const xs = r.voters.map((v) => v.authority).sort((a, b) => a - b);
  return xs.length ? xs[Math.floor(xs.length / 2)] : 0;
}

const SYSTEM = [
  'あなたは日本のポピュラー音楽史の研究者です。与えられた「データの証言」と作品情報だけを根拠に、',
  'この曲がなぜ次の世代へ語り継ぐべきかを日本語 150 字以内で述べてください。',
  '証言に無い固有名詞・数字・逸話は書かないこと。断定できないことは書かないこと。',
].join('');

export async function explain(
  ds: Dataset,
  g: Graph,
  r: Ranked,
  notes: Record<string, string>,
  llm?: LLM,
): Promise<Explanation> {
  const evidence = evidenceLines(ds, g, r);
  const note = notes[r.work.id];
  if (note) return { evidence, context: note, contextSource: 'notes' };
  if (llm && llm.kind === 'claude') {
    const user = [`作品: 「${r.work.title}」 ${credit(r)}`, 'データの証言:', ...evidence.map((l) => `- ${l}`)].join('\n');
    return { evidence, context: await llm.complete(SYSTEM, user), contextSource: 'llm' };
  }
  return { evidence };
}

export { credit };
