// Liveness probe for the web container (Docker HEALTHCHECK / hosting platform).
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ status: 'ok' });
}
