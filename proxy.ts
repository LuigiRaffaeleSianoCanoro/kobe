import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { access } from "@/lib/access";

const sha256 = (s: string) => createHash("sha256").update(s).digest();

function passwordFrom(req: NextRequest) {
  const [scheme, encoded] = req.headers.get("authorization")?.split(" ") ?? [];
  if (scheme !== "Basic" || !encoded) return "";
  const decoded = Buffer.from(encoded, "base64").toString();
  return decoded.slice(decoded.indexOf(":") + 1);
}

export function proxy(req: NextRequest) {
  const a = access();
  if (a.mode === "open") return NextResponse.next();
  if (a.mode === "locked") {
    if (!req.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
    return Response.json({ error: "Set KOBE_PASSWORD to enable the API on a production server." }, { status: 403 });
  }
  if (timingSafeEqual(sha256(passwordFrom(req)), sha256(a.password))) return NextResponse.next();
  return new Response("Sign in with any username and your KOBE_PASSWORD.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Kobe", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
