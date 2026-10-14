import { NextResponse, type NextRequest } from "next/server";

function isEmbeddablePath(path: string): boolean {
  return path === "/study" || path.startsWith("/ext/");
}

function applySecurityHeaders(res: NextResponse, embeddable: boolean): NextResponse {
  // Only the study surface may be framed, and only by the survey origin(s).
  // Everything else (API, root, admin) refuses to be framed at all.
  const ancestors = embeddable
    ? process.env.ALLOWED_FRAME_ANCESTORS || "'self'"
    : "'none'";
  res.headers.set("Content-Security-Policy", `frame-ancestors ${ancestors};`);
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-Content-Type-Options", "nosniff");
  // Study pages are reachable only via the survey; keep them out of indexes.
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export function middleware(req: NextRequest): NextResponse {
  return applySecurityHeaders(NextResponse.next(), isEmbeddablePath(req.nextUrl.pathname));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
