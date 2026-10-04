import { describe, expect, it } from "vitest";
import type { ImportReport } from "../../lib/whatsapp/import";
import { describeImport } from "../../lib/whatsapp/upload";

const TZ = "America/Argentina/Buenos_Aires";

const report = (overrides: Partial<ImportReport> = {}): ImportReport => ({
  importId: 7, chatName: "Valentina Ríos", isGroup: false, owner: "Leo Duarte",
  people: [{ id: "valentina-rios", name: "Valentina Ríos", created: true, messages: 1240 }],
  parsed: 1240, stored: 1240, duplicates: 0, ownerMessages: 600, media: 12, systemLines: 1,
  firstAt: "2024-03-02T13:15:42.000Z", lastAt: "2026-10-04T17:03:22.000Z", timeZone: TZ,
  ...overrides,
});

describe("describeImport", () => {
  it("says how many messages were added, with whom and since when", () => {
    const card = describeImport(report(), new Date("2026-10-04T20:00:00Z"));

    expect(card.summary).toBe("Added 1,240 messages with Valentina Ríos, Mar 2024 → today.");
    expect(card.range).toBe("Mar 2024 → today");
    expect(card.people).toEqual([{ id: "valentina-rios", name: "Valentina Ríos", created: true, messages: 1240 }]);
  });

  it("reads today in the chat's time zone, not in UTC", () => {
    // 22:00 on Oct 4 in Buenos Aires is already Oct 5 in UTC.
    const card = describeImport(report({ lastAt: "2026-10-05T01:00:00.000Z" }), new Date("2026-10-05T02:00:00Z"));

    expect(card.range).toBe("Mar 2024 → today");
  });

  it("counts only the new messages when part of the chat was stored before", () => {
    const card = describeImport(report({ stored: 40, duplicates: 1200 }), new Date("2026-11-20T12:00:00Z"));

    expect(card.summary).toBe("Added 40 new messages with Valentina Ríos, Mar 2024 → Oct 2026.");
  });

  it("says the chat is already up to date when every message was stored before", () => {
    const card = describeImport(report({ stored: 0, duplicates: 1240 }));

    expect(card.summary).toBe("Already up to date: Kobe had all 1,240 messages with Valentina Ríos.");
  });

  it("names the person on the roster rather than the chat, and a group by its name", () => {
    const renamed = report({ chatName: "Vale 🏀", people: [{ id: "valentina-rios", name: "Valentina Ríos", created: false, messages: 6 }], parsed: 6, stored: 6 });
    const group = report({ chatName: "Asado del sábado", isGroup: true, people: [], parsed: 6, stored: 6, firstAt: "2026-10-01T12:00:00.000Z" });
    const now = new Date("2026-10-04T20:00:00Z");

    expect(describeImport(renamed, now).summary).toBe("Added 6 messages with Valentina Ríos, Mar 2024 → today.");
    expect(describeImport(group, now).summary).toBe("Added 6 messages from Asado del sábado, Oct 2026 → today.");
  });
});
