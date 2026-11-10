'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { DoubanItem } from '@/lib/types';
import { DoubanCard } from './video-card';
import { Icon } from './icon';

const MOVIE_TAGS = ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动画'];
const TV_TAGS = ['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '综艺', '纪录片'];
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 首页推荐区：数据源由设置决定（豆瓣热门 / Bangumi 新番放送 / 影视热榜 / 自定义），单选展示 */
export function RecommendSection({ onPick }: { onPick: (title: string) => void }) {
  const doubanEnabled = useAppStore((s) => s.doubanEnabled);
  const recommendSource = useAppStore((s) => s.recommendSource);

  if (!doubanEnabled) return null;
  if (recommendSource === 'bangumi') return <BangumiView onPick={onPick} />;
  if (recommendSource === 'hot-list') return <HotListView onPick={onPick} />;
  if (recommendSource === 'custom') return <CustomView onPick={onPick} />;
  return <DoubanView onPick={onPick} />;
}

/**
 * 豆瓣推荐：影视切换 + 标签筛选。
 * 一次性渲染全部条目：数据本就一次拉全（50 条），卡片图片又是 lazy 加载，
 * 视口外的图不会请求，因此不需要「加载更多」这类本地切片分页来打断浏览。
 */
function DoubanView({ onPick }: { onPick: (title: string) => void }) {
  const [type, setType] = useState<'movie' | 'tv'>('movie');
  const [tag, setTag] = useState('热门');

  const query = useQuery({
    queryKey: ['douban', type, tag],
    queryFn: ({ signal }) => api.douban(type, tag, 0, 50, signal),
  });

  const tags = type === 'movie' ? MOVIE_TAGS : TV_TAGS;
  const items = query.data?.items ?? [];

  const switchType = (t: 'movie' | 'tv') => {
    if (t === type) return;
    setType(t);
    setTag('热门');
  };

  return (
    <section aria-label="影视推荐">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex bg-chip rounded-lg p-0.5">
            <TypeButton active={type === 'movie'} onClick={() => switchType('movie')}>
              电影
            </TypeButton>
            <TypeButton active={type === 'tv'} onClick={() => switchType('tv')}>
              剧集
            </TypeButton>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {tags.map((t) => (
          <button
            key={t}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs transition-colors',
              t === tag ? 'bg-accent text-on-accent' : 'bg-chip text-muted hover:text-content hover:bg-hover'
            )}
            onClick={() => setTag(t)}
          >
            {t}
          </button>
        ))}
        <CustomCategoryChips onPick={onPick} />
      </div>

      {query.isError ? (
        <p className="text-center text-sm text-faint py-8">推荐内容加载失败，可稍后重试或在设置中关闭</p>
      ) : query.isLoading ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <p className="text-center text-sm text-faint py-8">该分类暂无推荐内容</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
          {items.map((item) => (
            <DoubanCard key={item.id} item={item} onClick={() => onPick(item.title)} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Bangumi 每日放送：星期筛选，一次拉全量无分页 */
function BangumiView({ onPick }: { onPick: (title: string) => void }) {
  const [weekday, setWeekday] = useState<number | 'all'>('all');

  const query = useQuery({
    queryKey: ['bangumi-calendar'],
    queryFn: ({ signal }) => api.bangumiCalendar(signal),
  });

  let items: DoubanItem[] = [];
  if (query.data) {
    items = weekday === 'all'
      ? query.data.days.flatMap((d) => d.items)
      : (query.data.days.find((d) => d.weekday === weekday)?.items ?? []);
  }

  return (
    <section aria-label="新番放送推荐">
      <div className="flex flex-wrap gap-1.5 mb-4">
        <ChipButton active={weekday === 'all'} onClick={() => setWeekday('all')}>
          全部
        </ChipButton>
        {WEEKDAYS.map((name, i) => (
          <ChipButton key={name} active={weekday === i + 1} onClick={() => setWeekday(i + 1)}>
            {name}
          </ChipButton>
        ))}
        <CustomCategoryChips onPick={onPick} />
      </div>

      {query.isError ? (
        <p className="text-center text-sm text-faint py-8">推荐内容加载失败，可稍后重试或在设置中关闭</p>
      ) : query.isLoading ? (
        <GridSkeleton />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
          {items.map((item) => (
            <DoubanCard key={item.id} item={item} onClick={() => onPick(item.title)} />
          ))}
        </div>
      )}
    </section>
  );
}

const HOT_LISTS = [
  { id: 'douban_movie_weekly', label: '电影周榜' },
  { id: 'douban_tv_chinese', label: '国产剧周榜' },
  { id: 'douban_tv_global', label: '海外剧周榜' },
  { id: 'douban_show_chinese', label: '国内综艺' },
  { id: 'douban_show_global', label: '海外综艺' },
  { id: 'baidu_teleplay', label: '百度热播剧' },
];

/** 影视热榜（60s API）：豆瓣五个周榜 + 百度热播剧，chips 切换 */
function HotListView({ onPick }: { onPick: (title: string) => void }) {
  const [listId, setListId] = useState(HOT_LISTS[0].id);

  const query = useQuery({
    queryKey: ['hot-list', listId],
    queryFn: ({ signal }) => api.hotList(listId, signal),
  });

  const items = query.data?.items ?? [];

  return (
    <section aria-label="影视榜单推荐">
      <div className="flex flex-wrap gap-1.5 mb-4">
        {HOT_LISTS.map((l) => (
          <ChipButton key={l.id} active={listId === l.id} onClick={() => setListId(l.id)}>
            {l.label}
          </ChipButton>
        ))}
        <CustomCategoryChips onPick={onPick} />
      </div>

      {query.isError ? (
        <p className="text-center text-sm text-faint py-8">推荐内容加载失败，可稍后重试或在设置中关闭</p>
      ) : query.isLoading ? (
        <GridSkeleton />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
          {items.map((item) => (
            <DoubanCard key={item.id} item={item} onClick={() => onPick(item.title)} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * 自定义推荐：本地上传的 JSON 优先，其次走设置里填的接口地址（服务端代理拉取）。
 * 都没配时给出配置指引，而不是一片空白——用户此刻正需要知道去哪儿填。
 */
function CustomView({ onPick }: { onPick: (title: string) => void }) {
  const url = useAppStore((s) => s.customRecommendUrl);
  const localItems = useAppStore((s) => s.customRecommendItems);
  const hasLocal = localItems.length > 0;

  const query = useQuery({
    queryKey: ['custom-recommend', url],
    queryFn: ({ signal }) => api.customRecommend(url, signal),
    enabled: !hasLocal && Boolean(url.trim()),
  });

  const items: DoubanItem[] = hasLocal ? localItems.map((item, i) => ({ id: `local-${i}`, ...item })) : (query.data?.items ?? []);
  const unconfigured = !hasLocal && !url.trim();

  return (
    <section aria-label="自定义推荐">
      <div className="flex flex-wrap gap-1.5 mb-4">
        <CustomCategoryChips onPick={onPick} />
      </div>

      {unconfigured ? (
        <p className="text-center text-sm text-faint py-8 leading-relaxed">
          尚未配置自定义推荐源。到「设置 → 偏好设置 → 首页与内容 → 推荐数据源」选择<span className="text-content">自定义</span>，
          填入 JSON 接口地址或上传本地 JSON 文件（需含 <code className="text-accent text-xs">title</code> 字段）。
        </p>
      ) : query.isError && !hasLocal ? (
        <p className="text-center text-sm text-faint py-8">
          自定义推荐加载失败：{(query.error as Error)?.message || '请检查接口地址'}
        </p>
      ) : query.isLoading && !hasLocal ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <p className="text-center text-sm text-faint py-8">该推荐源暂无内容</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
          {items.map((item) => (
            <DoubanCard key={item.id} item={item} onClick={() => onPick(item.title)} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * 自定义分类胶囊：追加在推荐区胶囊行末尾。
 * 点分类名展开小标签，点小标签直接按该词搜索；无标签的分类不展示（点开也没东西可点）。
 */
function CustomCategoryChips({ onPick }: { onPick: (title: string) => void }) {
  const categories = useAppStore((s) => s.customCategories);
  const [openId, setOpenId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点空白处收起；点胶囊本身由按钮自己切换
  useEffect(() => {
    if (!openId) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openId]);

  const visible = categories.filter((c) => c.enabled && c.tags.length > 0);
  if (visible.length === 0) return null;

  return (
    <div ref={rootRef} className="flex flex-wrap items-center gap-1.5">
      {visible.map((c) => {
        const open = openId === c.id;
        return (
          <div key={c.id} className="relative">
            <button
              className={cn(
                'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs transition-colors',
                open ? 'bg-accent text-on-accent' : 'bg-chip text-muted hover:text-content hover:bg-hover'
              )}
              aria-expanded={open}
              aria-label={`${c.name}，展开小标签`}
              onClick={() => setOpenId(open ? null : c.id)}
            >
              {c.name}
              <Icon name="chevronDown" className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
            </button>
            {open && (
              <div
                className="absolute left-0 top-full mt-1 z-30 min-w-[6rem] rounded-lg border border-line bg-surface-raised shadow-xl p-1 flex flex-col"
                role="menu"
                aria-label={`${c.name} 的小标签`}
              >
                {c.tags.map((tag) => (
                  <button
                    key={tag}
                    role="menuitem"
                    className="text-left text-xs whitespace-nowrap px-2 py-1.5 rounded-md text-muted hover:text-content hover:bg-hover transition-colors"
                    onClick={() => {
                      setOpenId(null);
                      onPick(tag);
                    }}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}


function GridSkeleton() {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
      {Array.from({ length: 16 }).map((_, i) => (
        <div key={i}>
          <div className="aspect-[2/3] rounded-lg bg-chip animate-pulse" />
          <div className="h-3 mt-2 rounded bg-chip animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function ChipButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={cn(
        'px-2.5 py-1 rounded-full text-xs transition-colors',
        active ? 'bg-accent text-on-accent' : 'bg-chip text-muted hover:text-content hover:bg-hover'
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function TypeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={cn('px-3.5 py-1.5 rounded-md text-sm transition-colors', active ? 'bg-accent text-on-accent' : 'text-muted hover:text-content')}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
