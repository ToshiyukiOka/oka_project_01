// YouTube Data API v3 アダプタ。docs/01 §5。
// 必要なもの: 環境変数 YOUTUBE_API_KEY（Google Cloud で YouTube Data API v3 を有効化して発行）。
// クォータ（既定 10,000 units/日）: search.list = 100 / ページ、videos.list・channels.list = 1 / 50 件。
// スクレイピングはしない（利用規約違反）。取得データの保存期間は YouTube API Services Developer Policies に従うこと。

import type { Cover, Work } from '../types.ts';
import type { Identity } from '../identity.ts';
import { classify, type YtVideo } from './classify.ts';

const API = 'https://www.googleapis.com/youtube/v3';

export const QUOTA = { searchPage: 100, videosBatch: 1, channelsBatch: 1 } as const;

type Fetch = typeof fetch;

export class YouTubeClient {
  quotaUsed = 0;
  private readonly apiKey: string;
  private readonly fetchImpl: Fetch;

  constructor(apiKey: string, fetchImpl: Fetch = fetch) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  private async get<T>(path: string, params: Record<string, string>, cost: number): Promise<T> {
    const qs = new URLSearchParams({ ...params, key: this.apiKey });
    const res = await this.fetchImpl(`${API}/${path}?${qs}`);
    this.quotaUsed += cost;
    if (!res.ok) throw new Error(`YouTube API ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }

  async search(q: string, pageToken?: string) {
    type R = { items: Array<{ id: { videoId?: string } }>; nextPageToken?: string };
    const r = await this.get<R>(
      'search',
      {
        part: 'snippet',
        type: 'video',
        q,
        maxResults: '50',
        regionCode: 'JP',
        relevanceLanguage: 'ja',
        ...(pageToken ? { pageToken } : {}),
      },
      QUOTA.searchPage,
    );
    return { ids: r.items.map((i) => i.id.videoId).filter((x): x is string => !!x), next: r.nextPageToken };
  }

  async videos(ids: string[]): Promise<YtVideo[]> {
    type R = {
      items: Array<{
        id: string;
        snippet: { title: string; description: string; channelId: string; channelTitle: string; publishedAt: string };
        statistics?: { viewCount?: string };
      }>;
    };
    const out: YtVideo[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const r = await this.get<R>(
        'videos',
        { part: 'snippet,statistics', id: ids.slice(i, i + 50).join(','), maxResults: '50' },
        QUOTA.videosBatch,
      );
      for (const it of r.items)
        out.push({ id: it.id, ...it.snippet, viewCount: Number(it.statistics?.viewCount ?? 0) });
    }
    return out;
  }

  async channelSubscribers(ids: string[]): Promise<Map<string, number>> {
    type R = { items: Array<{ id: string; statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean } }> };
    const out = new Map<string, number>();
    const uniq = [...new Set(ids)];
    for (let i = 0; i < uniq.length; i += 50) {
      const r = await this.get<R>('channels', { part: 'statistics', id: uniq.slice(i, i + 50).join(',') }, QUOTA.channelsBatch);
      for (const it of r.items) out.set(it.id, Number(it.statistics?.subscriberCount ?? 0));
    }
    return out;
  }
}

// 作品ごとの検索クエリ。
//   「曲名 作曲者」… Art Track の説明欄にはクレジットが載るので、他者が商業リリースした録音が引っかかる
//   「曲名 カバー」「曲名 歌ってみた」… 一般投稿の層
export function queriesFor(w: Work): string[] {
  const qs = [`${w.title} ${w.composer[0] ?? ''}`.trim(), `${w.title} カバー`, `${w.title} 歌ってみた`];
  if (w.intl) qs.push(`${w.title} cover`);
  return qs;
}

export function estimateQuota(works: Work[], pagesPerQuery = 1, candidatesPerPage = 50) {
  const searches = works.reduce((s, w) => s + queriesFor(w).length * pagesPerQuery, 0);
  const videos = Math.ceil((searches * candidatesPerPage) / 50);
  return { searches, units: searches * QUOTA.searchPage + videos * QUOTA.videosBatch * 2, perDayAtDefault: 10_000 };
}

export interface CollectStats {
  candidates: number;
  accepted: number;
  rejected: Record<string, number>;
}

export async function collectWork(
  w: Work,
  yt: YouTubeClient,
  identity: Identity,
  pagesPerQuery = 1,
): Promise<{ covers: Cover[]; stats: CollectStats }> {
  const ids = new Set<string>();
  for (const q of queriesFor(w)) {
    let token: string | undefined;
    for (let p = 0; p < pagesPerQuery; p++) {
      const r = await yt.search(q, token);
      r.ids.forEach((id) => ids.add(id));
      if (!r.next) break;
      token = r.next;
    }
  }
  const videos = await yt.videos([...ids]);
  const subs = await yt.channelSubscribers(videos.map((v) => v.channelId));
  const stats: CollectStats = { candidates: videos.length, accepted: 0, rejected: {} };
  const covers: Cover[] = [];
  for (const v of videos) {
    const d = classify(w, { ...v, channelSubscribers: subs.get(v.channelId) }, identity);
    if (d.kind === 'reject') {
      stats.rejected[d.reason] = (stats.rejected[d.reason] ?? 0) + 1;
      continue;
    }
    stats.accepted++;
    covers.push({
      workId: w.id,
      artist: d.artist,
      kind: d.artistKind,
      via: d.layer === 'art-track' ? 'youtube-art-track' : 'youtube-ugc',
      src: `https://www.youtube.com/watch?v=${v.id}`,
      year: d.year,
      views: v.viewCount,
      aiSuspect: d.aiSuspect || undefined,
    });
  }
  return { covers, stats };
}
