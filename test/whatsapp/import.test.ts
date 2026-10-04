import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { importWhatsAppExport } from "../../lib/whatsapp/import";
import { ImportError } from "../../lib/whatsapp/parse";

const TZ = "America/Argentina/Buenos_Aires";
const REMOTE_DB_TIMEOUT_MS = 60_000;
const fixture = (name: string) => readFileSync(new URL(`../fixtures/whatsapp/${name}`, import.meta.url), "utf8");
const uniqueSuffix = () => Math.random().toString(36).slice(2, 8);

beforeEach(() => {
  vi.stubEnv("KOBE_OWNER_NAME", "");
});

describe("importWhatsAppExport before it touches the database", () => {
  const untouched = {} as Sql;

  it("asks for the owner's name when a 1:1 chat does not say who is who", async () => {
    const bytes = strToU8(fixture("android-en.txt"));

    await expect(importWhatsAppExport(untouched, { fileName: "chat.txt", bytes, timeZone: TZ })).rejects.toThrow(
      /Kobe cannot tell which side of this chat is you\. Set KOBE_OWNER_NAME .* "Tomás Herrera" or "Leo Duarte"/,
    );
  });

  it("rejects an owner name that sent nothing in a 1:1 chat, naming the one that did", async () => {
    const bytes = strToU8(fixture("android-en.txt"));
    const input = { fileName: "WhatsApp Chat with Tomás Herrera.txt", bytes, ownerName: "Luigi", timeZone: TZ };

    await expect(importWhatsAppExport(untouched, input)).rejects.toThrow(/"Luigi" sent no messages .* "Leo Duarte"/);
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("importWhatsAppExport against Postgres", { timeout: REMOTE_DB_TIMEOUT_MS }, () => {
  let db: Sql;

  beforeAll(async () => {
    const parsed = new URL(url!);
    parsed.searchParams.delete("channel_binding");
    db = postgres(parsed.toString(), { prepare: false, max: 2, onnotice: () => {} });
    await db.file(fileURLToPath(new URL("../../db/schema.sql", import.meta.url)));
  });

  afterAll(async () => {
    await db?.end();
  });

  const iosSpanish = (name: string) => ({
    fileName: `WhatsApp Chat - ${name}.zip`,
    bytes: zipSync({ "_chat.txt": strToU8(fixture("ios-es/_chat.txt").replaceAll("Valentina Ríos", name)) }),
    timeZone: TZ,
  });

  it("stores nothing new when the same export is imported twice", async () => {
    const name = `Valentina Ríos ${uniqueSuffix()}`;

    const first = await importWhatsAppExport(db, iosSpanish(name));
    const second = await importWhatsAppExport(db, iosSpanish(name));

    expect(first).toMatchObject({ parsed: 6, stored: 6, duplicates: 0 });
    expect(second).toMatchObject({ parsed: 6, stored: 0, duplicates: 6 });
    expect(second.people).toEqual([{ id: first.people[0].id, name, created: false, messages: 6 }]);
    const [{ count }] = await db`select count(*)::int as count from messages where chat_name = ${name}`;
    expect(count).toBe(6);
  });

  it("imports the same new contact once when two uploads arrive together", async () => {
    const name = `Valentina Ríos ${uniqueSuffix()}`;

    const reports = await Promise.all([importWhatsAppExport(db, iosSpanish(name)), importWhatsAppExport(db, iosSpanish(name))]);

    expect(reports.map((r) => r.people[0].created).sort()).toEqual([false, true]);
    expect(reports.map((r) => r.stored).sort()).toEqual([0, 6]);
    const [{ people }] = await db`select count(*)::int as people from people where name = ${name}`;
    expect(people).toBe(1);
  });

  it("reports what it stored, for whom and over which dates, creating an unknown contact for review", async () => {
    const name = `Valentina Ríos ${uniqueSuffix()}`;

    const report = await importWhatsAppExport(db, iosSpanish(name));

    expect(report).toEqual({
      importId: expect.any(Number), chatName: name, isGroup: false, owner: "Leo Duarte",
      people: [{ id: expect.any(String), name, created: true, messages: 6 }],
      parsed: 6, stored: 6, duplicates: 0, ownerMessages: 2, media: 1, systemLines: 1,
      firstAt: "2026-03-02T13:15:42.000Z", lastAt: "2026-10-04T17:03:22.000Z", timeZone: TZ,
    });
    const [person] = await db`select name, role, needs_review, sources from people where id = ${report.people[0].id}`;
    expect(person).toEqual({ name, role: "New from WhatsApp", needs_review: true, sources: ["WHATSAPP"] });
    const [row] = await db`select stored_count, message_count, owner_name from imports where id = ${report.importId}`;
    expect(row).toEqual({ stored_count: 6, message_count: 6, owner_name: "Leo Duarte" });
  });

  it("marks the owner's messages as sent by the owner", async () => {
    const report = await importWhatsAppExport(db, iosSpanish(`Valentina Ríos ${uniqueSuffix()}`));

    const rows = await db`
      select sender, from_owner, count(*)::int as count from messages
      where person_id = ${report.people[0].id} group by sender, from_owner order by sender`;
    expect(rows).toEqual([
      { sender: "Leo Duarte", from_owner: true, count: 2 },
      { sender: report.chatName, from_owner: false, count: 4 },
    ]);
  });

  it("links a 1:1 chat to the person on the roster despite accents, case and emoji, keeping same-minute repeats", async () => {
    const t = uniqueSuffix();
    const rosterName = `Tomas Herrera ${t}`;
    const chatName = `TOMÁS Herrera 🏀 ${t}`;
    await db`insert into people (id, name, sources) values (${`tomas-${t}`}, ${rosterName}, '{GMAIL}')`;
    const text = fixture("android-en.txt").replaceAll("Tomás Herrera", chatName);

    const report = await importWhatsAppExport(db, {
      fileName: `WhatsApp Chat with ${chatName}.txt`,
      bytes: strToU8(text),
      timeZone: TZ,
    });

    expect(report).toMatchObject({ owner: "Leo Duarte", isGroup: false, stored: 6, ownerMessages: 2, media: 1 });
    expect(report.people).toEqual([{ id: `tomas-${t}`, name: rosterName, created: false, messages: 6 }]);
    const [person] = await db`select sources, needs_review from people where id = ${`tomas-${t}`}`;
    expect(person).toEqual({ sources: ["GMAIL", "WHATSAPP"], needs_review: false });
    const [{ count }] = await db`select count(*)::int as count from messages where person_id = ${`tomas-${t}`} and body = 'Perfect'`;
    expect(count).toBe(2);
    const [{ people }] = await db`select count(*)::int as people from people where name in (${rosterName}, ${chatName})`;
    expect(people).toBe(1);
  });

  it("stores a group chat and links only the senders who are on the roster", async () => {
    const t = uniqueSuffix();
    const tomas = `Tomás Herrera ${t}`;
    const valentina = `Valentina Ríos ${t}`;
    await db`insert into people (id, name) values (${`tomas-${t}`}, ${tomas}), (${`valentina-${t}`}, ${valentina})`;
    const text = fixture("android-es.txt").replaceAll("Tomás Herrera", tomas).replaceAll("Valentina Ríos", valentina);

    const report = await importWhatsAppExport(db, {
      fileName: `Chat de WhatsApp con Asado del sábado ${t}.txt`,
      bytes: strToU8(text),
      ownerName: "Leo Duarte",
      timeZone: TZ,
    });

    expect(report).toMatchObject({ chatName: `Asado del sábado ${t}`, isGroup: true, owner: "Leo Duarte", stored: 6, systemLines: 5 });
    expect(report.people).toEqual([
      { id: `tomas-${t}`, name: tomas, created: false, messages: 2 },
      { id: `valentina-${t}`, name: valentina, created: false, messages: 1 },
    ]);
    const rows = await db`
      select sender, person_id, from_owner from messages
      where import_id = ${report.importId} order by sent_at, id`;
    expect(rows).toEqual([
      { sender: tomas, person_id: `tomas-${t}`, from_owner: false },
      { sender: "Leo Duarte", person_id: null, from_owner: true },
      { sender: "Nico", person_id: null, from_owner: false },
      { sender: "+1 555-0142", person_id: null, from_owner: false },
      { sender: valentina, person_id: `valentina-${t}`, from_owner: false },
      { sender: tomas, person_id: `tomas-${t}`, from_owner: false },
    ]);
  });

  const counts = async () => {
    const [row] = await db`
      select (select count(*) from imports)::int as imports, (select count(*) from messages)::int as messages,
             (select count(*) from people)::int as people`;
    return row;
  };

  it("rejects a malformed file with a readable error and stores nothing", async () => {
    const before = await counts();

    const attempt = importWhatsAppExport(db, {
      fileName: `WhatsApp Chat with Sam Carter ${uniqueSuffix()}.txt`,
      bytes: strToU8("Dear diary,\ntoday was a good day."),
      timeZone: TZ,
    });

    await expect(attempt).rejects.toThrow(ImportError);
    await expect(attempt).rejects.toThrow(/not a WhatsApp chat export/);
    expect(await counts()).toEqual(before);
  });

  it("rolls back the new person and the import when storing a message fails", async () => {
    const name = `Sam Carter ${uniqueSuffix()}`;
    const text = fixture("ios-en/_chat.txt").replaceAll("Sam Carter", name).replace("See you tomorrow", "See you\u0000tomorrow");
    const before = await counts();

    const attempt = importWhatsAppExport(db, { fileName: `WhatsApp Chat - ${name}.txt`, bytes: strToU8(text), timeZone: TZ });

    await expect(attempt).rejects.toThrow();
    expect(await counts()).toEqual(before);
  });
});
