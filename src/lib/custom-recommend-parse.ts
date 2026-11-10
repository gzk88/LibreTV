import type { DoubanItem } from './types';

/**
 * 自定义推荐 JSON 的解析（纯函数，无服务端依赖）。
 *
 * 之所以单独拆一个文件：这份解析客户端也要用（上传本地 JSON 文件时先在浏览器里
 * 归一化再入库），而 custom-recommend.ts 里的拉取逻辑用到了 node:dns，
 * 混在一起会把服务端模块带进客户端 bundle。
 *
 * 支持的数据形状（尽量宽容，用户手上的数据多半是各处导出的）：
 * - 裸数组：`[{ "title": "...", "cover": "..." }]`
 * - 带 items 的对象：`{ "items": [...] }`（也兼容 list / data / results / subjects / videos）
 *
 * 单条只需 `title`（必填）与 `cover`（选填），评分字段 `rating|score|vote_average|rate` 均可。
 */

/** 单次最多保留 200 条：再多首屏也没人翻，且会撑爆 localStorage */
export const MAX_CUSTOM_ITEMS = 200;

const ARRAY_KEYS = ['items', 'list', 'data', 'results', 'subjects', 'videos', 'movies'];
const TITLE_KEYS = ['title', 'name', 'vod_name', 'movie_name', 'subject', 'cn_name'];
const COVER_KEYS = ['cover', 'pic', 'poster', 'image', 'img', 'vod_pic', 'cover_url', 'poster_path', 'img_url'];
const RATING_KEYS = ['rating', 'score', 'vote_average', 'rate', 'douban_score'];
const ID_KEYS = ['id', 'vid', 'vod_id', 'subject_id', 'imdb_id', 'tmdb_id'];

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    // 有的接口评分/ID 是数字
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

/** 把任意形状的 JSON 归一化为首页卡片可用的条目；title 缺失的条目直接丢弃 */
export function normalizeCustomRecommendPayload(raw: unknown): DoubanItem[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    for (const key of ARRAY_KEYS) {
      if (Array.isArray(obj[key])) {
        list = obj[key] as unknown[];
        break;
      }
    }
  }

  const seen = new Set<string>();
  const items: DoubanItem[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    const title = pickString(obj, TITLE_KEYS);
    if (!title) continue;
    // 同名片按标题去重（上传的清单里重复很常见）
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const rating = pickString(obj, RATING_KEYS);
    items.push({
      id: pickString(obj, ID_KEYS) || `custom-${items.length}`,
      title,
      cover: pickString(obj, COVER_KEYS),
      rating: rating || undefined,
    });
    if (items.length >= MAX_CUSTOM_ITEMS) break;
  }
  return items;
}
