import { NextResponse, type NextRequest } from "next/server";

function applyStudyHeaders(res: NextResponse): NextResponse {
  const ancestors = process.env.ALLOWED_FRAME_ANCESTORS || "'self'";
  res.headers.set(
    "Content-Security-Policy",
    `frame-ancestors ${ancestors};`,
  );
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return res;
}

export function middleware(req: NextRequest): NextResponse {
  const path = req.nextUrl.pathname;
  const shouldApply = path === "/study" || path.startsWith("/ext/");
  if (!shouldApply) return NextResponse.next();
  return applyStudyHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/study", "/ext/:path*"],
};
