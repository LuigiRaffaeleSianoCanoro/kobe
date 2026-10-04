import assert from "node:assert/strict";
import test from "node:test";
import { applyServerEnv } from "./server-env.ts";

test("server env fills gateway settings from dotenv files", () => {
  const target: Record<string, string | undefined> = {};
  applyServerEnv(
    {
      NEON_AI_GATEWAY_TOKEN: "nt_live_file",
      NEON_AI_GATEWAY_BASE_URL: "http://127.0.0.1:8787",
      KOBE_MODEL: "neon/gpt-oss-120b",
      KOBE_PASSWORD: "court",
      DATABASE_URL: "postgres://secret",
      VITE_PUBLIC: "visible",
    },
    target,
  );
  assert.deepEqual(target, {
    NEON_AI_GATEWAY_TOKEN: "nt_live_file",
    NEON_AI_GATEWAY_BASE_URL: "http://127.0.0.1:8787",
    KOBE_MODEL: "neon/gpt-oss-120b",
    KOBE_PASSWORD: "court",
  });
});

test("a value already in the environment wins over the file", () => {
  const target: Record<string, string | undefined> = { NEON_AI_GATEWAY_TOKEN: "from-shell" };
  applyServerEnv({ NEON_AI_GATEWAY_TOKEN: "from-file", KOBE_PASSWORD: "court" }, target);
  assert.equal(target.NEON_AI_GATEWAY_TOKEN, "from-shell");
  assert.equal(target.KOBE_PASSWORD, "court");
});
