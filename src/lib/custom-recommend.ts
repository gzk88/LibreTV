import type { DoubanItem } from './types';
import { fetchUpstream, getCache, setCache } from './fetch-utils';
import { parseCustomRecommendPayload, type ParsedCustomCategory } from './custom-recommend-parse';

/**
 * 自定义首页推荐源的服务端拉取（仅服务端使用：依赖 fetch-utils / SSRF 校验）。
 * 解析规则见 custom-recommend-parse.ts（纯函数，客户端也复用）。
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

/** 返回给前端时只带分类元信息，条目按当前分类单独下发（首屏不必传全部数据） */
export interface CustomRecommendCategoryMeta {
  id: string;
  name: string;
  count: number;
}

export interface CustomRecommendResult {
  categories: CustomRecommendCategoryMeta[];
  items: DoubanItem[];
}

/** 拉取并解析整份 JSON（分类 + 条目都缓存住，切分类不用重复出网） */
async function fetchParsed(url: string): Promise<ParsedCustomCategory[]> {
  const cacheKey = `custom-recommend:${url}`;
  const cached = getCache<ParsedCustomCategory[]>(cacheKey);
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

  const parsed = parseCustomRecommendPayload(raw);
  if (parsed.items.length === 0) throw new Error('没有解析到可用条目（需要 title 字段）');

  // 统一存成「分类数组」：没有 categories 的旧格式也包成单个匿名分类，下面按 tid 取
  const groups: ParsedCustomCategory[] =
    parsed.categories.length > 0 ? parsed.categories : [{ id: '', name: '推荐', items: parsed.items }];

  setCache(cacheKey, groups, CACHE_TTL_MS);
  return groups;
}

/**
 * 拉取自定义推荐；tid 指定分类 id（没有分类数据时忽略）。
 * 未指定 tid 时返回第一个分类，保证首屏有内容。
 */
export async function fetchCustomRecommend(url: string, tid = ''): Promise<CustomRecommendResult> {
  const groups = await fetchParsed(url);
  const hasCategories = groups.length > 1 || groups[0]?.id !== '';
  const target = (tid && groups.find((g) => g.id === tid)) || groups[0];

  return {
    categories: hasCategories
      ? groups.map((g) => ({ id: g.id, name: g.name, count: g.items.length }))
      : [],
    items: target?.items ?? [],
  };
}
