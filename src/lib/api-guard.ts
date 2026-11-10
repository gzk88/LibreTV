import { NextResponse } from 'next/server';
import { isPasswordConfigured, sessionFromCookieHeader } from './auth';

/**
 * API Route 共享守卫。
 *
 * - 未设置 PASSWORD：免登录模式，直接放行（旧版这里返回 503 让整站不可用）；
 * - 已设置 PASSWORD：未登录返回 401。
 */
export function guardRequest(req: Request): NextResponse | null {
  if (!isPasswordConfigured()) return null;
  if (!sessionFromCookieHeader(req.headers.get('cookie'))) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  return null;
}

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
