import { NextResponse } from 'next/server';
import { SESSION_COOKIE, checkRateLimit, sessionFromCookieHeader, signSession, checkPassword, clearRateLimit, isPasswordConfigured } from '@/lib/auth';

export const runtime = 'nodejs';

/** 统一写会话 cookie：Secure 标记按 COOKIE_SECURE / x-forwarded-proto 推导 */
function attachSessionCookie(req: Request, res: NextResponse, token: string, maxAge: number): NextResponse {
  // 不能依赖 req.url——Next.js Route Handler 中它是内部转发地址，并非用户侧的原始协议。
  const secure = process.env.COOKIE_SECURE === 'true'
    ? true
    : process.env.COOKIE_SECURE === 'false'
      ? false
      : (req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? 'http') === 'https';
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge,
    path: '/',
  });
  return res;
}

export async function POST(req: Request) {
  // 免登录模式：未设置 PASSWORD 时无需校验，直接下发会话（保持前端登录流程的兼容）
  if (!isPasswordConfigured()) {
    const { token, expiresAt } = signSession();
    return attachSessionCookie(
      req,
      NextResponse.json({ success: true, authDisabled: true }),
      token,
      Math.floor((expiresAt - Date.now()) / 1000)
    );
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { success: false, error: '尝试次数过多，请 10 分钟后再试' },
      { status: 429 }
    );
  }

  let password = '';
  try {
    const body = (await req.json()) as { password?: string };
    password = String(body.password ?? '');
  } catch {
    return NextResponse.json({ success: false, error: '请求格式错误' }, { status: 400 });
  }

  if (!checkPassword(password)) {
    return NextResponse.json({ success: false, error: '密码错误' }, { status: 401 });
  }

  clearRateLimit(ip);
  const { token, expiresAt } = signSession();
  return attachSessionCookie(
    req,
    NextResponse.json({ success: true }),
    token,
    Math.floor((expiresAt - Date.now()) / 1000)
  );
}

/** GET：查询当前会话状态（免登录模式下恒定已通过） */
export async function GET(req: Request) {
  const verified = !isPasswordConfigured() || sessionFromCookieHeader(req.headers.get('cookie'));
  return NextResponse.json({ success: true, verified, authDisabled: !isPasswordConfigured() });
}

/** DELETE：登出 */
export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, maxAge: 0, path: '/' });
  return res;
}
