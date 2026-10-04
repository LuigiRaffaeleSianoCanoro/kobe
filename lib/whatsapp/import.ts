import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import { readExportFile } from "./export-file";
import { ImportError, parseWhatsAppChat } from "./parse";

export type ImportReport = {
  importId: number; chatName: string; isGroup: boolean; owner: string | null;
  people: { id: string; name: string; created: boolean; messages: number }[];
  parsed: number; stored: number; duplicates: number; ownerMessages: number;
  media: number; systemLines: number; firstAt: string; lastAt: string; timeZone: string;
};

type PersonRow = { id: string; name: string };

const DEFAULT_TIME_ZONE = "America/Argentina/Buenos_Aires";
const BATCH = 1000;

const normalizeName = (name: string) =>
  name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function findByFullOrUniqueFirstName(names: string[], name: string): string | undefined {
  const key = normalizeName(name);
  const exact = names.find((n) => normalizeName(n) === key);
  if (exact || key.includes(" ")) return exact;
  const byFirst = names.filter((n) => normalizeName(n).split(" ")[0] === key);
  return byFirst.length === 1 ? byFirst[0] : undefined;
}

function resolveOwner(senders: string[], chatName: string | null, configured: string | null): string | null {
  const contact = chatName ? senders.find((s) => normalizeName(s) === normalizeName(chatName)) : undefined;
  const other = contact && senders.length === 2 ? senders.find((s) => s !== contact) : undefined;
  if (configured) {
    const owner = findByFullOrUniqueFirstName(senders, configured);
    if (!owner && other) {
      throw new ImportError(
        `"${configured}" sent no messages in this chat with ${contact}. Set KOBE_OWNER_NAME (or --owner) to your name exactly as this export shows it: "${other}".`,
      );
    }
    return owner ?? configured;
  }
  if (senders.length > 2) return null;
  if (contact) return other ?? null;
  throw new ImportError(
    `Kobe cannot tell which side of this chat is you. Set KOBE_OWNER_NAME in .env.local, or pass --owner, with your name exactly as this export shows it: ${senders.map((s) => `"${s}"`).join(" or ")}.`,
  );
}

function uniqueId(name: string, people: PersonRow[]): string {
  const base = normalizeName(name).replace(/ /g, "-") || "whatsapp-contact";
  const taken = new Set(people.map((p) => p.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

export async function importWhatsAppExport(
  db: Sql,
  input: { fileName: string; bytes: Uint8Array; ownerName?: string; timeZone?: string },
): Promise<ImportReport> {
  const file = readExportFile(input.fileName, input.bytes);
  const timeZone = input.timeZone || process.env.KOBE_TIME_ZONE || DEFAULT_TIME_ZONE;
  const chat = parseWhatsAppChat(file.text, { timeZone });
  const named = file.chatName ?? chat.chatNameHint;
  const owner = resolveOwner(chat.senders, named, input.ownerName?.trim() || process.env.KOBE_OWNER_NAME?.trim() || null);
  const others = chat.senders.filter((s) => s !== owner);
  const isGroup = others.length > 1;
  const contact = isGroup ? null : (others[0] ?? named);
  if (!isGroup && !contact) throw new ImportError("Kobe cannot tell who this chat is with. Import the file with the name WhatsApp gave it.");
  const chatName = named ?? contact ?? others.join(", ");

  const chatKey = named ? normalizeName(named) : chat.senders.map(normalizeName).sort().join("|");
  const repeats = new Map<string, number>();
  const messages = chat.messages.map((m) => {
    const sentAt = m.sentAt.toISOString();
    const key = JSON.stringify([m.sender, sentAt, m.body]);
    const repeatIndex = repeats.get(key) ?? 0;
    repeats.set(key, repeatIndex + 1);
    return { ...m, hash: createHash("sha256").update(JSON.stringify([chatKey, m.sender, sentAt, m.body, repeatIndex])).digest("hex") };
  });
  const times = messages.map((m) => m.sentAt.getTime());
  const firstAt = new Date(times.reduce((a, b) => Math.min(a, b)));
  const lastAt = new Date(times.reduce((a, b) => Math.max(a, b)));

  return db.begin(async (tx) => {
    const people = await tx<PersonRow[]>`select id, name from people`;
    const personNamed = (name: string) => {
      const match = findByFullOrUniqueFirstName(people.map((p) => p.name), name);
      return people.find((p) => p.name === match);
    };
    const personOf = new Map<string, PersonRow | undefined>();
    let created: PersonRow | null = null;
    if (contact) {
      let person = personNamed(contact);
      if (!person) {
        person = created = { id: uniqueId(contact, people), name: contact };
        await tx`
          insert into people (id, name, role, needs_review, sources)
          values (${person.id}, ${person.name}, 'New from WhatsApp', true, '{WHATSAPP}')`;
      }
      for (const sender of chat.senders) personOf.set(sender, person);
    } else {
      for (const sender of others) personOf.set(sender, personNamed(sender));
    }
    const linked = [...new Set(personOf.values())].filter((p) => p !== undefined);
    if (linked.length) {
      await tx`
        update people set sources = array_append(sources, 'WHATSAPP')
        where id in ${tx(linked.map((p) => p.id))} and not ('WHATSAPP' = any(sources))`;
    }

    const [{ id }] = await tx`
      insert into imports (file_name, chat_name, is_group, owner_name, message_count, stored_count, first_at, last_at)
      values (${input.fileName}, ${chatName}, ${isGroup}, ${owner}, ${messages.length}, 0, ${firstAt}, ${lastAt})
      returning id`;
    let stored = 0;
    for (let i = 0; i < messages.length; i += BATCH) {
      const rows = messages.slice(i, i + BATCH).map((m) => ({
        person_id: personOf.get(m.sender)?.id ?? null, chat_name: chatName, sender: m.sender, from_owner: m.sender === owner,
        sent_at: m.sentAt, body: m.body, kind: m.kind, import_id: id, content_hash: m.hash,
      }));
      stored += (await tx`insert into messages ${tx(rows)} on conflict (content_hash) do nothing`).count;
    }
    await tx`update imports set stored_count = ${stored} where id = ${id}`;

    return {
      importId: Number(id), chatName, isGroup, owner,
      people: linked.map((p) => ({
        id: p.id, name: p.name, created: p === created, messages: messages.filter((m) => personOf.get(m.sender) === p).length,
      })),
      parsed: messages.length, stored, duplicates: messages.length - stored,
      ownerMessages: messages.filter((m) => m.sender === owner).length,
      media: messages.filter((m) => m.kind === "media").length,
      systemLines: chat.systemLines, firstAt: firstAt.toISOString(), lastAt: lastAt.toISOString(), timeZone,
    };
  });
}
