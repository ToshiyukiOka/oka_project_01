# Kataritsugi（語り継ぎ）— 名曲の本質ランキング・エンジン

> 「酒と泪と男と女」のような名曲を次の世代へ手渡すために、
> **誰に・何世代に・どこまで歌い継がれたか** で曲を評価する、PageRank 型のランキング・エンジン。

再生数や売上は使わない。**カバー（他の歌い手による歌い直し）を、歌い手の質で重み付けした推薦票**として扱い、
歌い手×作品の二部グラフ上で PageRank（CoverRank）を回す。そこに `世代到達 × 越境 × 持続` の補正を掛ける。
設計の全体は [`docs/01_ranking_system.md`](docs/01_ranking_system.md) を参照。

## 動かし方

Node 22.18 以上。依存パッケージは不要（Node の型ストリッピングでそのまま動く）。

```bash
cd kataritsugi
npm test                      # 単体テスト（PageRank の性質・セルフカバー除外・YouTube 判定器・API モック）
npm run rank                  # ランキングを表示
npm run report                # out/RANKING.md・out/ranking.json を生成（頑健性区間と「なぜ語り継ぐべきか」付き）
npm run explain -- 喝采        # 1 曲の内訳（誰の票がどれだけ効いたか）
npm run status                # 証拠収集の進捗（未調査の曲の一覧）
npm run quota                 # 全候補を YouTube で収集した場合の API クォータ見積り

# YouTube Data API v3 で証拠を収集（Art Track = プロ層 / 歌ってみた等 = 民の層）
YOUTUBE_API_KEY=... npm run youtube -- --limit 5
# ANTHROPIC_API_KEY があれば、監修ノートの無い曲の「文脈の解説」を証拠に制約して LLM が書く
```

## 構成

| パス | 役割 | 設計書 |
| --- | --- | --- |
| `src/types.ts` | 作品・カバー・歌い手・パラメータの型と既定値 | §2 |
| `src/identity.ts` | 名寄せ（本人・バンド・別名義）とセルフカバー判定 | §2 |
| `src/graph.ts` | 歌い手×作品の二部グラフ構築（帰属 π / 1−π、除外理由の記録） | §3.1 |
| `src/coverrank.ts` | **CoverRank**（二部グラフ上の PageRank、べき乗法） | §3.2 |
| `src/legacy.ts` | 世代到達・越境・持続の補正と最終スコア | §4 |
| `src/robustness.ts` | パラメータ感度・証拠欠損ブートストラップ・素朴カウントとの比較 | §7 |
| `src/explain.ts` | 「なぜ語り継ぐべきか」（データの証言 + 文脈の解説） | §8 |
| `src/ingest/youtube.ts` | YouTube Data API v3 アダプタ（検索・動画・チャンネル、クォータ計上） | §5 |
| `src/ingest/classify.ts` | Art Track の構文解析、カバー判定（同名異曲・カラオケ・AI 歌声・セルフ） | §5.1–5.2 |
| `seed/works.json` | 候補 223 曲（1927〜2023 年の邦楽、作家クレジット付き） | |
| `seed/covers.*.json` | カバーの証拠（すべて証拠 URL 付き。収集手段ごとに 1 ファイル） | |
| `seed/collection.json` | 作品ごとの収集状況と注記（未調査を「0 件」と誤認しないため） | |
| `seed/artists.json` | 歌い手のデビュー年代・畑・国（年代粒度の推定。不明は空欄） | |
| `seed/identities.json` | 同じ創作主体のグループ | |
| `seed/curation.json` | 名寄せ（表記ゆれ）・理由付きの除外・種別補正（証拠ファイルは書き換えない） | |
| `out/` | 生成物（`npm run report`） | |

## 現状（PoC）

- 候補 223 曲のうち、収集手順を最後まで終えたのは **204 曲**（カバー辺は約 1,000 件。そのうち出典 URL のある 994 件をグラフに使用）。途中の 4 曲と未調査の 15 曲はランキングの対象外にしている。進捗は `npm run status` で確認できる。収集の手順と基準は [`docs/02_data_collection.md`](docs/02_data_collection.md) を参照。
- 証拠は**抜き取り調査**であって網羅的ではない。[`out/RANKING.md`](out/RANKING.md) は確定版の Top 50 ではなく、**収集を終えた曲だけで動かした暫定の途中経過**である。順位には、パラメータ感度（486 通り）と、証拠を 30% 欠損させた場合の順位区間を併記している。
- 確定版を出すには、残りの曲の証拠収集が必要になる。YouTube API キー、またはカタログ API へのネットワーク許可があれば網羅性を上げられる（設計書 §9）。
