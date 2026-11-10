import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchCustomRecommend } from '@/lib/custom-recommend';
import { isValidProxyUrl } from '@/lib/ssrf';

export const runtime = 'nodejs';

/**
 * 自定义首页推荐源：服务端代理拉取用户填写的 JSON 接口。
 * 走服务端有两个原因：目标接口多半没有 CORS 头，且需要统一过 SSRF 校验再出网。
 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const url = new URL(req.url).searchParams.get('url')?.trim() || '';
  if (!url) {
    return NextResponse.json({ error: '缺少 url 参数' }, { status: 400 });
  }
  if (!isValidProxyUrl(url)) {
    return NextResponse.json({ error: '地址不在允许范围内（仅支持公网 http/https）' }, { status: 400 });
  }

  try {
    const items = await fetchCustomRecommend(url);
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '自定义推荐源获取失败' },
      { status: 502 }
    );
  }
}
