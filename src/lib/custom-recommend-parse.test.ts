import { describe, expect, it } from 'vitest';
import { MAX_CUSTOM_ITEMS, normalizeCustomRecommendPayload } from './custom-recommend-parse';

/** 自定义推荐 JSON 归一化：形状兼容、字段别名、去重与上限 */

describe('normalizeCustomRecommendPayload', () => {
  it('裸数组：只保留 title 存在的条目', () => {
    const items = normalizeCustomRecommendPayload([
      { title: '星际穿越', cover: 'https://img/a.jpg', rating: 9.4 },
      { name: '盗梦空间', pic: 'https://img/b.jpg' },
      { cover: 'https://img/no-title.jpg' },
      '垃圾数据',
    ]);
    expect(items).toEqual([
      { id: 'custom-0', title: '星际穿越', cover: 'https://img/a.jpg', rating: '9.4' },
      { id: 'custom-1', title: '盗梦空间', cover: 'https://img/b.jpg', rating: undefined },
    ]);
  });

  it('对象包装：items / list / data / subjects 都能取到', () => {
    for (const key of ['items', 'list', 'data', 'subjects']) {
      const items = normalizeCustomRecommendPayload({ [key]: [{ title: '沙丘' }] });
      expect(items.map((i) => i.title)).toEqual(['沙丘']);
    }
  });

  it('同名片按标题去重，id 字段优先使用', () => {
    const items = normalizeCustomRecommendPayload([
      { id: 42, title: '沙丘2', poster: 'https://img/c.jpg' },
      { id: 43, title: '沙丘2', poster: 'https://img/d.jpg' },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: '42', title: '沙丘2', cover: 'https://img/c.jpg' });
  });

  it('无法识别的形状返回空数组（交给上层报「没有可用条目」）', () => {
    expect(normalizeCustomRecommendPayload(null)).toEqual([]);
    expect(normalizeCustomRecommendPayload('string')).toEqual([]);
    expect(normalizeCustomRecommendPayload({ items: 'not-array' })).toEqual([]);
  });

  it('超过上限时截断', () => {
    const many = Array.from({ length: MAX_CUSTOM_ITEMS + 30 }, (_, i) => ({ title: `片${i}` }));
    expect(normalizeCustomRecommendPayload(many)).toHaveLength(MAX_CUSTOM_ITEMS);
  });
});
