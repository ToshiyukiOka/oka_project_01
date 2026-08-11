// LLM ポート。歩くスケルトンは StubLLM でオフライン動作する。
// ANTHROPIC_API_KEY があれば ClaudeLLM に自動で切り替わり、実際の抽出・言い換えを行う。

export interface LLM {
  readonly kind: 'stub' | 'claude';
  complete(system: string, user: string): Promise<string>;
}

// ---- オフライン・スタブ（決定的。パイプラインを通すのが目的） ----
export class StubLLM implements LLM {
  readonly kind = 'stub' as const;
  async complete(_system: string, user: string): Promise<string> {
    // 実 LLM の代わりに、入力を素直に返すだけ（言い換えはしない）。
    return user.trim();
  }
}

// ---- Claude アダプタ（任意。鍵がある時だけ使う） ----
export class ClaudeLLM implements LLM {
  readonly kind = 'claude' as const;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model = 'claude-opus-4-8') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async complete(system: string, user: string): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
    return data.content.map((c) => c.text ?? '').join('').trim();
  }
}

export function getLLM(): LLM {
  const key = process.env.ANTHROPIC_API_KEY;
  return key ? new ClaudeLLM(key) : new StubLLM();
}
