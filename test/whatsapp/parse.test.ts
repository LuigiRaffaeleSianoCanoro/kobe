import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ImportError, parseWhatsAppChat } from "../../lib/whatsapp/parse";

const TZ = "America/Argentina/Buenos_Aires";
const fixture = (name: string) => readFileSync(new URL(`../fixtures/whatsapp/${name}`, import.meta.url), "utf8");
const parse = (text: string) => parseWhatsAppChat(text, { timeZone: TZ });
const at = (iso: string) => new Date(iso);

describe("parseWhatsAppChat", () => {
  it("reads an iPhone export in Spanish: day-first dates, LRM marks, media and the encryption notice", () => {
    const chat = parse(fixture("ios-es/_chat.txt"));

    expect(chat.platform).toBe("ios");
    expect(chat.senders).toEqual(["Valentina Ríos", "Leo Duarte"]);
    expect(chat.chatNameHint).toBe("Valentina Ríos");
    expect(chat.systemLines).toBe(1);
    expect(chat.messages).toEqual([
      { sentAt: at("2026-03-02T13:15:42Z"), sender: "Valentina Ríos", body: "¡Hola! ¿Seguimos con el café del jueves?", kind: "text" },
      { sentAt: at("2026-03-02T13:17:05Z"), sender: "Leo Duarte", body: "Sí, dale. ¿A las 9 en el lugar de siempre?", kind: "text" },
      {
        sentAt: at("2026-03-02T13:18:30Z"),
        sender: "Valentina Ríos",
        body: "Perfecto. Te paso la lista para el asado:\n- carbón\n- chimichurri\n\n- pan",
        kind: "text",
      },
      { sentAt: at("2026-03-14T22:02:11Z"), sender: "Valentina Ríos", body: "imagen omitida", kind: "media" },
      { sentAt: at("2026-03-14T22:03:00Z"), sender: "Leo Duarte", body: "¡Qué lindo! ¿Dónde es?", kind: "text" },
      { sentAt: at("2026-10-04T17:03:22Z"), sender: "Valentina Ríos", body: "Feliz cumple adelantado 🎂", kind: "text" },
    ]);
  });

  it("reads an iPhone export in English: month-first dates, 12 AM and 12 PM, and iOS notices", () => {
    const chat = parse(fixture("ios-en/_chat.txt"));

    expect(chat.platform).toBe("ios");
    expect(chat.senders).toEqual(["Sam Carter", "Leo Duarte"]);
    expect(chat.chatNameHint).toBe("Sam Carter");
    expect(chat.systemLines).toBe(2);
    expect(chat.messages.map((m) => [m.sentAt.toISOString(), m.sender, m.kind])).toEqual([
      ["2026-03-02T12:05:41.000Z", "Sam Carter", "text"],
      ["2026-03-02T15:00:00.000Z", "Leo Duarte", "text"],
      ["2026-03-03T03:30:15.000Z", "Sam Carter", "media"],
      ["2026-03-15T22:45:00.000Z", "Leo Duarte", "text"],
      ["2026-10-05T02:59:59.000Z", "Sam Carter", "text"],
    ]);
    expect(chat.messages[2].body).toBe("image omitted");
    expect(chat.messages[3].body).toBe("Running late, save me a seat\non the left side");
  });

  it("reads an Android group export in Spanish: system lines, ~ senders, phone numbers and media", () => {
    const chat = parse(fixture("android-es.txt"));

    expect(chat.platform).toBe("android");
    expect(chat.chatNameHint).toBeNull();
    expect(chat.systemLines).toBe(5);
    expect(chat.senders).toEqual(["Tomás Herrera", "Leo Duarte", "Nico", "+1 555-0142", "Valentina Ríos"]);
    expect(chat.messages.map((m) => [m.sentAt.toISOString(), m.sender, m.body, m.kind])).toEqual([
      ["2026-03-02T21:05:00.000Z", "Tomás Herrera", "¿Quién lleva el carbón?", "text"],
      ["2026-03-02T21:06:00.000Z", "Leo Duarte", "Yo llevo carbón y hielo", "text"],
      ["2026-03-02T21:07:00.000Z", "Nico", "Yo llevo las bebidas\ny hielo extra", "text"],
      ["2026-03-02T21:08:00.000Z", "+1 555-0142", "<Multimedia omitido>", "media"],
      ["2026-03-14T00:30:00.000Z", "Valentina Ríos", "¿A qué hora arrancamos?", "text"],
      ["2026-03-14T00:31:00.000Z", "Tomás Herrera", "A las 13", "text"],
    ]);
  });

  it("reads an Android export in English whose dates fit both orders, choosing the one that keeps time moving forward", () => {
    const chat = parse(fixture("android-en.txt"));

    expect(chat.systemLines).toBe(1);
    expect(chat.senders).toEqual(["Tomás Herrera", "Leo Duarte"]);
    expect(chat.messages.map((m) => [m.sentAt.toISOString(), m.body, m.kind])).toEqual([
      ["2026-09-12T12:12:00.000Z", "Morning! Did you get the tickets?", "text"],
      ["2026-09-12T12:15:00.000Z", "Got them. Section 112", "text"],
      ["2026-09-12T12:15:00.000Z", "<Media omitted>", "media"],
      ["2026-10-01T15:05:00.000Z", "Perfect", "text"],
      ["2026-10-01T15:05:00.000Z", "Perfect", "text"],
      ["2026-10-04T01:30:00.000Z", "Can't wait.\nBringing the foam finger", "text"],
    ]);
  });

  it("reads day-first when every date fits both orders and time moves forward either way", () => {
    const chat = parse("01/02/26, 10:00 - Sam Carter: hi\n01/02/26, 10:01 - Leo Duarte: hey\n");

    expect(chat.messages[0].sentAt.toISOString()).toBe("2026-02-01T13:00:00.000Z");
  });

  it("handles a BOM, Windows line endings and Spanish a. m. / p. m. markers", () => {
    const chat = parse("\uFEFF4/10/26, 2:03\u202Fp.\u00A0m. - Valentina Ríos: hola\r\nque tal\r\n5/10/26, 12:10 a. m. - Leo Duarte: buenas\r\n");

    expect(chat.messages.map((m) => [m.sentAt.toISOString(), m.body])).toEqual([
      ["2026-10-04T17:03:00.000Z", "hola\nque tal"],
      ["2026-10-05T03:10:00.000Z", "buenas"],
    ]);
  });

  it("converts wall time in the given time zone", () => {
    const chat = parseWhatsAppChat("[04/10/26, 14:03:22] Sam Carter: hi", { timeZone: "Europe/Madrid" });

    expect(chat.messages[0].sentAt.toISOString()).toBe("2026-10-04T12:03:22.000Z");
  });

  it.each([
    ["plain text", "Dear diary,\ntoday was a good day.", /not a WhatsApp chat export: no line starts with a date/],
    ["text before the first message", "Chat history\n04/10/26, 14:03 - Sam Carter: hi", /not a WhatsApp chat export: line 1 does not/],
    [
      "dates in another format",
      "2026-10-04 14:03 Sam\n04/10/26 14h03 Sam: a\n04/10/26 14h04 Sam: b\n04/10/26, 14:05 - Sam Carter: c",
      /not a WhatsApp chat export: 2 lines start with a date in a format Kobe does not recognize/,
    ],
    ["only notices", "04/10/26, 14:03 - Messages and calls are end-to-end encrypted.", /no messages to import/],
    ["a date that does not exist", "31/02/26, 14:03 - Sam Carter: hi", /Line 1 .* does not exist/],
    ["an empty file", "", /not a WhatsApp chat export/],
  ])("rejects %s with a readable error", (_, text, message) => {
    expect(() => parse(text)).toThrow(ImportError);
    expect(() => parse(text)).toThrow(message);
  });

  it("rejects an unknown time zone with a readable error", () => {
    expect(() => parseWhatsAppChat("04/10/26, 14:03 - Sam Carter: hi", { timeZone: "Mars/Olympus" })).toThrow(
      /"Mars\/Olympus" is not a time zone/,
    );
  });
});
