import type { NextRequest } from 'next/server';

// Server-side proxy: Browser -> Next.js (this file) -> Express API. The browser never learns
// the API's address, there is no CORS, and API_URL is read per request, so the same built
// image works in any environment.
export const dynamic = 'force-dynamic';

const FORWARDED_HEADERS = ['authorization', 'content-type', 'accept', 'x-request-id'];

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  const apiUrl = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
  const target = `${apiUrl}/api/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;

  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Keep the real client address so the API's rate limiter sees users, not this server.
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) headers.set('x-forwarded-for', forwardedFor);

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.text() : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return Response.json(
      { error: { code: 'API_UNAVAILABLE', message: 'The ride service is not reachable right now. Please retry shortly.' } },
      { status: 502 },
    );
  }
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
