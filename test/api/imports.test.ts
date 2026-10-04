import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "@/proxy";

const ENDPOINT = "http://localhost/api/imports/whatsapp";
const REMOTE_DB_TIMEOUT_MS = 60_000;
const fixture = (name: string) => readFileSync(new URL(`../fixtures/whatsapp/${name}`, import.meta.url), "utf8");
const uniqueSuffix = () => Math.random().toString(36).slice(2, 8);

function upload(file?: File) {
  const body = new FormData();
  if (file) body.set("file", file);
  return new Request(ENDPOINT, { method: "POST", body });
}

// lib/db.ts reads DATABASE_URL once, when it is first imported.
async function routeWithDatabase(databaseUrl: string) {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", databaseUrl);
  const route = await import("@/app/api/imports/whatsapp/route");
  const { sql } = await import("@/lib/db");
  return { POST: route.POST, sql };
}

beforeEach(() => {
  vi.stubEnv("KOBE_OWNER_NAME", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("uploads behind the KOBE_PASSWORD rule", () => {
  const request = (credentials?: string) =>
    new NextRequest(ENDPOINT, { method: "POST", headers: credentials ? { authorization: `Basic ${btoa(credentials)}` } : {} });

  it("runs the proxy for the upload endpoint", () => {
    expect(unstable_doesMiddlewareMatch({ config, url: "/api/imports/whatsapp" })).toBe(true);
  });

  it("asks for the password before an upload reaches the importer", () => {
    vi.stubEnv("KOBE_PASSWORD", "courtside");

    expect(proxy(request()).status).toBe(401);
    expect(proxy(request("me:wrong")).status).toBe(401);
    expect(proxy(request("me:courtside")).headers.get("x-middleware-next")).toBe("1");
  });

  it("refuses uploads on a production server that has no password", () => {
    vi.stubEnv("KOBE_PASSWORD", "");
    vi.stubEnv("NODE_ENV", "production");

    expect(proxy(request()).status).toBe(403);
  });
});

describe("POST /api/imports/whatsapp without a database", () => {
  it("explains that importing needs a database", async () => {
    const { POST, sql } = await routeWithDatabase("");

    const res = await POST(upload(new File(["hi"], "WhatsApp Chat - Sam Carter.txt")));

    expect(sql).toBeNull();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/needs a database/) });
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("POST /api/imports/whatsapp against Postgres", { timeout: REMOTE_DB_TIMEOUT_MS }, () => {
  let route: Awaited<ReturnType<typeof routeWithDatabase>>;

  beforeAll(async () => {
    route = await routeWithDatabase(url!);
    await route.sql!.file(fileURLToPath(new URL("../../db/schema.sql", import.meta.url)));
  });

  afterAll(async () => {
    await route?.sql?.end();
  });

  it("stores the export and answers with the roster that now includes the new contact", async () => {
    const name = `Valentina Ríos ${uniqueSuffix()}`;
    const zip = zipSync({ "_chat.txt": strToU8(fixture("ios-es/_chat.txt").replaceAll("Valentina Ríos", name)) });

    const res = await route.POST(upload(new File([zip], `WhatsApp Chat - ${name}.zip`, { type: "application/zip" })));

    expect(res.status).toBe(200);
    const { report, roster } = await res.json();
    expect(report).toMatchObject({ chatName: name, isGroup: false, stored: 6, people: [{ name, created: true, messages: 6 }] });
    expect(roster).toContainEqual(expect.objectContaining({ id: report.people[0].id, name, role: "New from WhatsApp", sources: ["WHATSAPP"] }));
  });

  it("answers a file that is not a WhatsApp export with a readable error", async () => {
    const res = await route.POST(upload(new File(["Dear diary,\ntoday was a good day."], "notes.txt", { type: "text/plain" })));

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/^This file is not a WhatsApp chat export/) });
  });

  it("rejects a request that carries no file", async () => {
    const res = await route.POST(upload());

    expect(res.status).toBe(400);
  });
});
