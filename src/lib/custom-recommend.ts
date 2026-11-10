import type { DoubanItem } from './types';
import { fetchUpstream, getCache, setCache } from './fetch-utils';
import { normalizeCustomRecommendPayload } from './custom-recommend-parse';

/**
 * 自定义首页推荐源的服务端拉取（仅服务端使用：依赖 fetch-utils / SSRF 校验）。
 * 解析规则见 custom-recommend-parse.ts（纯函数，客户端也复用）。
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

/** 服务端拉取并解析自定义推荐接口（走统一 SSRF 校验 + 5 分钟缓存） */
export async function fetchCustomRecommend(url: string): Promise<DoubanItem[]> {
  const cached = getCache<DoubanItem[]>(`custom-recommend:${url}`);
  if (cached) return cached;

  const res = await fetchUpstream(url, {
    timeoutMs: 8000,
    retries: 1,
    headers: {
      accept: 'application/json, text/plain, */*',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
  if (!res.ok) throw new Error(`接口返回 ${res.status}`);

  const text = await res.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('返回内容不是合法 JSON');
  }

  const items = normalizeCustomRecommendPayload(raw);
  if (items.length === 0) throw new Error('没有解析到可用条目（需要 title 字段）');
  setCache(`custom-recommend:${url}`, items, CACHE_TTL_MS);
  return items;
}
