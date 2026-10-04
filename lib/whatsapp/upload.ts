import type { AttachmentAdapter, PendingAttachment } from "@assistant-ui/react";
import type { Person } from "../data";
import type { ImportReport } from "./import";

export type ImportResult = { report: ImportReport; roster: Person[] };

// What Kobe's card shows after an import. The summary is also what the model reads in later turns.
export type ImportCard = Pick<ImportReport, "people" | "isGroup" | "chatName" | "parsed" | "stored"> & { summary: string; range: string };

const MAX_BYTES = 50 * 1024 * 1024;
const EXPORT_FILE = /\.(zip|txt)$/i;

const count = (n: number) => n.toLocaleString("en-US");

export function describeImport(r: ImportReport, now = new Date()): ImportCard {
  const month = new Intl.DateTimeFormat("en-US", { timeZone: r.timeZone, month: "short", year: "numeric" });
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: r.timeZone });
  const first = month.format(new Date(r.firstAt));
  const last = day.format(new Date(r.lastAt)) === day.format(now) ? "today" : month.format(new Date(r.lastAt));
  const range = first === last ? first : `${first} → ${last}`;
  const who = r.isGroup ? `from ${r.chatName}` : `with ${r.people[0]?.name ?? r.chatName}`;
  const summary =
    r.stored === 0
      ? `Already up to date: Kobe had all ${count(r.parsed)} messages ${who}.`
      : `Added ${count(r.stored)} ${r.duplicates ? "new " : ""}messages ${who}, ${range}.`;
  return { summary, range, people: r.people, isGroup: r.isGroup, chatName: r.chatName, parsed: r.parsed, stored: r.stored };
}

async function upload(file: File): Promise<ImportResult> {
  if (!EXPORT_FILE.test(file.name)) {
    throw new Error("Kobe imports WhatsApp chat exports only: the .zip or .txt file that Export chat creates.");
  }
  if (file.size > MAX_BYTES) throw new Error("This file is larger than 50 MB. Export the chat again and choose Without media.");
  const body = new FormData();
  body.set("file", file);
  const res = await fetch("/api/imports/whatsapp", { method: "POST", body });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? `The import failed (HTTP ${res.status}). Try again in a moment.`);
  return json;
}

// The server parses and stores the chat, so a long export never blocks the page. One upload at a
// time: two exports of the same new contact must not race to create them.
let queue: Promise<unknown> = Promise.resolve();

// Files dropped on the chat or picked with the paperclip become composer attachments. The chip shows
// progress and any error; once the import is stored, `onImported` posts Kobe's card and drops the chip.
export function whatsAppAttachments(onImported: (result: ImportResult, file: { id: string; name: string }) => void): AttachmentAdapter {
  return {
    accept: "*",
    async *add({ file }) {
      const pending: PendingAttachment = {
        // Not crypto.randomUUID(): it only exists on https:// and localhost pages.
        id: `whatsapp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: "document",
        name: file.name,
        contentType: file.type,
        file,
        status: { type: "running", reason: "uploading", progress: 0 },
      };
      yield pending;
      const done = queue.then(() => upload(file));
      queue = done.catch(() => {});
      onImported(await done, pending);
    },
    // Imports never ride along with a chat message.
    async send(attachment) {
      return { ...attachment, status: { type: "complete" }, content: [] };
    },
    async remove() {},
  };
}
