import type { IncomingMessage, ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Connect, type Plugin } from "vite";
import { refuseApi } from "./lib/access";
import { createAgentReply } from "./server/agent-reply";
import { applyServerEnv } from "./server/server-env";

const MAX_BODY_CHARS = 100_000;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += buf.length;
      if (size > MAX_BODY_CHARS) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function authorizationHeader(req: IncomingMessage): string | null {
  const value = req.headers.authorization;
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

// The gateway token is read in the Node process. Vite's client env prefix stays VITE_, so the token is not inlined.
function agentApi(): Plugin {
  const handle = async (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    if (req.method !== "POST") {
      next();
      return;
    }
    const refusal = refuseApi(authorizationHeader(req));
    if (refusal) {
      req.resume();
      res.statusCode = refusal.status;
      for (const [key, value] of Object.entries(refusal.headers)) res.setHeader(key, value);
      res.end(refusal.body);
      return;
    }
    try {
      const raw = await readBody(req);
      let body: unknown;
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        send(res, 400, { text: "Kobe couldn't read that." });
        return;
      }
      send(res, 200, await createAgentReply(body));
    } catch (error) {
      if (error instanceof Error && error.message === "too large") {
        send(res, 413, { text: "That note is too long." });
        return;
      }
      next(error);
    }
  };
  const attach = (server: { middlewares: Connect.Server }) => {
    server.middlewares.use("/api/agent", (req, res, next) => {
      void handle(req, res, next);
    });
  };
  return { name: "kobe-agent-api", configureServer: attach, configurePreviewServer: attach };
}

export default defineConfig(({ mode }) => {
  // `.env.local` is the documented place for the gateway token. Load it for this Node process only.
  // envPrefix stays VITE_, so the token is not exposed to the browser.
  const fromFiles = loadEnv(mode, process.cwd(), "");
  applyServerEnv(fromFiles, process.env);
  return {
    plugins: [react(), agentApi()],
    envPrefix: "VITE_",
  };
});
