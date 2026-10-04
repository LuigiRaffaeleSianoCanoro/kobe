import { createHash, timingSafeEqual } from "node:crypto";

export type Access = { mode: "open" } | { mode: "password"; password: string } | { mode: "locked" };

// /api/chat spends the gateway token and /api/season reads and writes your records, so a
// production server only serves them behind KOBE_PASSWORD. `next dev` stays open for local work.
export function access(): Access {
  const password = process.env.KOBE_PASSWORD;
  if (password) return { mode: "password", password };
  return process.env.NODE_ENV === "production" ? { mode: "locked" } : { mode: "open" };
}

export type ApiRefusal = {
  status: 401 | 403;
  body: string;
  headers: Record<string, string>;
};

const sha256 = (value: string) => createHash("sha256").update(value).digest();

function passwordFrom(authorization: string | null): string {
  if (!authorization) return "";
  const [scheme, encoded] = authorization.split(" ");
  if (scheme !== "Basic" || !encoded) return "";
  const decoded = Buffer.from(encoded, "base64").toString();
  return decoded.slice(decoded.indexOf(":") + 1);
}

/**
 * Same gate as the Next proxy for an API that spends the gateway token.
 * Null means the request may continue. A refusal must be returned before any gateway call.
 */
export function refuseApi(authorization: string | null): ApiRefusal | null {
  const gate = access();
  if (gate.mode === "open") return null;
  if (gate.mode === "locked") {
    return {
      status: 403,
      body: JSON.stringify({ error: "Set KOBE_PASSWORD to enable the API on a production server." }),
      headers: { "content-type": "application/json; charset=utf-8" },
    };
  }
  if (timingSafeEqual(sha256(passwordFrom(authorization)), sha256(gate.password))) return null;
  return {
    status: 401,
    body: "Sign in with any username and your KOBE_PASSWORD.",
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "WWW-Authenticate": 'Basic realm="Kobe", charset="UTF-8"',
    },
  };
}
