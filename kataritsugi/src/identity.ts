// 名寄せとセルフカバー判定。
// 「同じ創作主体」（本人・所属バンド・別名義）を 1 つの ID にまとめ、
// 原唱者・作詞・作曲者と同一主体による再録はカバー（=他者への伝承）として数えない。

// 表記ゆれの吸収: NFKC・空白除去・ラテン文字は小文字化。
export function normName(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

export class Identity {
  private readonly canon = new Map<string, string>(); // normName -> 代表名

  constructor(groups: string[][]) {
    for (const g of groups) {
      if (g.length === 0) continue;
      // 既に別グループに属する名前があれば、そのグループに合流させる（推移的に統合）
      const existing = g.map((n) => this.canon.get(normName(n))).find((c) => c !== undefined);
      const head = existing ?? g[0];
      for (const n of g) {
        const prev = this.canon.get(normName(n));
        if (prev && prev !== head) this.relabel(prev, head);
        this.canon.set(normName(n), head);
      }
    }
  }

  private relabel(from: string, to: string) {
    for (const [k, v] of this.canon) if (v === from) this.canon.set(k, to);
  }

  // 代表名（同一主体なら同じ文字列を返す）
  id(name: string): string {
    return this.canon.get(normName(name)) ?? normName(name);
  }

  // 表示名: グループがあれば代表名、なければ入力そのもの
  display(name: string): string {
    return this.canon.get(normName(name)) ?? name.trim();
  }

  // カバーした人が、原唱者・作詞・作曲者のいずれかと同一主体か
  isSelf(coverer: string, creators: string[]): boolean {
    const c = this.id(coverer);
    return creators.some((x) => this.id(x) === c);
  }
}
