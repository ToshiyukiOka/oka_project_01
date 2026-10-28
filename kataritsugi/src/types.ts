// Kataritsugi（語り継ぎ）— 名曲の「本質ランキング」エンジンのドメイン型。
// docs/01_ranking_system.md §2（データモデル）に対応。

// 原曲・歌い手の音楽的出自。越境性（どれだけ異なる畑の歌い手に渡ったか）の計算に使う。
export type Genre =
  | 'doyo' // 童謡・唱歌・歌曲
  | 'kayo' // 歌謡曲
  | 'enka' // 演歌
  | 'folk' // フォーク
  | 'newmusic' // ニューミュージック / シンガーソングライター
  | 'citypop' // シティポップ
  | 'rock' // ロック / バンド
  | 'idol' // アイドル
  | 'jpop' // J-POP
  | 'jazz' // ジャズ / クラシック / 声楽 / ワールド
  | 'anime' // アニソン
  | 'vocaloid' // ボカロ
  | 'okinawa'; // 沖縄音楽

// 歌い手の種別。PageRank のテレポート事前分布（=1票の基礎重み）を決める。
//   pro     : 商業リリースのある歌手・バンド
//   foreign : 海外の歌手（国境を越えた伝承の証拠）
//   net     : 歌い手 / VTuber / YouTuber（ネット発）
//   choir   : 合唱団
//   amateur : YouTube 上の一般投稿（民の伝承層）
export type ArtistKind = 'pro' | 'foreign' | 'net' | 'choir' | 'amateur';

// 楽曲（作品）。録音ではなく「作品」単位で同定する（ISWC / MusicBrainz Work に相当）。
export interface Work {
  id: string;
  title: string;
  original: string[]; // 原唱者（空 = 童謡などで原唱者が定まらない）
  lyricist: string[];
  composer: string[];
  year: number; // 初出年
  genre: Genre;
  intl: boolean; // 海外カバーの探索対象か（収集クエリ用）
}

// カバー 1 件 = 「歌い手 a が作品 w を自分の声で歌い直した」という証拠付きの辺。
export interface Cover {
  workId: string;
  artist: string;
  kind: ArtistKind;
  via: 'title' | 'summary' | 'youtube-art-track' | 'youtube-ugc';
  src: string; // 証拠 URL
  year?: number; // カバーの公開年（YouTube なら投稿日 / Art Track なら Released on）
  views?: number;
  aiSuspect?: boolean; // AI 音声合成カバーの疑い（伝承の証拠として扱わない）
}

// 歌い手のメタデータ。世代到達（何世代に渡ったか）と越境性の計算に使う。
export interface ArtistMeta {
  debutDecade?: number; // 1960 = 1960 年代デビュー。不明なら undefined（推定しない）
  genre?: Genre;
  country?: string; // ISO 3166-1 alpha-2。'JP' 以外は国境越え
}

export interface Dataset {
  works: Work[];
  covers: Cover[];
  artists: Record<string, ArtistMeta>;
  identities: string[][]; // 同一の創作主体（本人・所属バンド・別名義）。セルフカバー判定と名寄せに使う
}

// ---- アルゴリズムのパラメータ（docs/01 §3–§4） ----
export interface Params {
  damping: number; // d: 「カバーの原曲を辿る」確率。1-d でテレポート
  performerShare: number; // π: 作品から原唱者へ戻る流量の割合（残りは作詞・作曲者へ）
  outDegreeExp: number; // λ: 1票の分割指数。1 = 純 PageRank（多数カバーする人の1曲あたりの票は薄まる）
  kindPrior: Record<ArtistKind, number>; // 種別ごとのテレポート事前重み
  genBonus: number; // α: 世代到達ボーナスの強さ
  genCap: number; // 世代到達の飽和点（何世代で満点か）
  crossBonus: number; // β: 越境ボーナスの強さ
  burstFloor: number; // 単発バズ（短期集中）の最大減点後の下限。年情報が無ければ適用しない
}

export const DEFAULT_PARAMS: Params = {
  damping: 0.85,
  performerShare: 0.5,
  outDegreeExp: 1,
  kindPrior: { pro: 1, foreign: 1, net: 0.5, choir: 0.3, amateur: 0.05 },
  genBonus: 0.5,
  genCap: 4,
  crossBonus: 0.3,
  burstFloor: 0.6,
};

// ---- 出力 ----
export interface Voter {
  artist: string;
  vote: number; // この作品に流れ込んだ権威量（R(a) · d · q / out(a)^λ）
  authority: number; // 歌い手自身の権威 R(a)
}

export interface Ranked {
  rank: number;
  work: Work;
  score: number; // 0–100 に正規化した語り継ぎスコア
  raw: number; // 正規化前（CoverRank × 世代 × 越境 × 持続）
  coverRank: number; // CoverRank（作品を通過する権威の流量）
  coverCount: number; // 有効カバー数（セルフカバー・AI 疑い除外後）
  generations: number[]; // 原曲以降に歌い継いだ歌い手のデビュー年代（重複なし・昇順）
  genMultiplier: number;
  effectiveGenres: number; // 歌い手ジャンルの実効数 exp(H)
  foreignCount: number;
  crossMultiplier: number;
  burstMultiplier: number;
  voters: Voter[]; // 票の大きい順
}
