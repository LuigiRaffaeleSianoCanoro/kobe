import assert from "node:assert/strict";
import test from "node:test";
import { refuseApi } from "./access.ts";

const saved = {
  password: process.env.KOBE_PASSWORD,
  nodeEnv: process.env.NODE_ENV,
};

function restore() {
  if (saved.password === undefined) delete process.env.KOBE_PASSWORD;
  else process.env.KOBE_PASSWORD = saved.password;
  if (saved.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = saved.nodeEnv;
}

function basic(password: string) {
  return `Basic ${Buffer.from(`kobe:${password}`).toString("base64")}`;
}

test("development without a password leaves the API open", () => {
  delete process.env.KOBE_PASSWORD;
  process.env.NODE_ENV = "development";
  try {
    assert.equal(refuseApi(null), null);
  } finally {
    restore();
  }
});

test("a password refuses requests that do not present it", () => {
  process.env.KOBE_PASSWORD = "court";
  process.env.NODE_ENV = "development";
  try {
    const missing = refuseApi(null);
    const wrong = refuseApi(basic("nope"));
    assert.equal(missing?.status, 401);
    assert.equal(wrong?.status, 401);
    assert.match(missing?.body ?? "", /KOBE_PASSWORD/);
    assert.equal(missing?.headers["WWW-Authenticate"], 'Basic realm="Kobe", charset="UTF-8"');
    assert.equal(refuseApi(basic("court")), null);
  } finally {
    restore();
  }
});

test("production without a password locks the API", () => {
  delete process.env.KOBE_PASSWORD;
  process.env.NODE_ENV = "production";
  try {
    const refusal = refuseApi(basic("court"));
    assert.equal(refusal?.status, 403);
    assert.equal(JSON.parse(refusal?.body ?? "{}").error.includes("KOBE_PASSWORD"), true);
  } finally {
    restore();
  }
});
