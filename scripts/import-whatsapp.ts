import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { sql } from "../lib/db";
import { importWhatsAppExport, type ImportReport } from "../lib/whatsapp/import";
import { ImportError } from "../lib/whatsapp/parse";

const USAGE = 'Usage: pnpm import:whatsapp <export.zip|export.txt> [--owner "Your Name"] [--tz Area/City]';

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function describeReport(r: ImportReport): string[] {
  const day = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: r.timeZone }).format(new Date(iso));
  const who = r.people.length
    ? r.people.map((p) => (r.isGroup ? `${p.name} (${count(p.messages, "message")})` : p.name)).join(", ")
    : "nobody on your roster";
  return [
    `Stored ${count(r.stored, "new message")} (${r.duplicates} already stored) for ${who}, ${day(r.firstAt)} → ${day(r.lastAt)}.`,
    `Chat "${r.chatName}"${r.isGroup ? " (group)" : ""}: ${count(r.parsed, "message")}, ${r.owner ? `${r.ownerMessages} from ${r.owner}` : "none marked as yours (set KOBE_OWNER_NAME)"}, ${count(r.media, "media placeholder")}, ${count(r.systemLines, "WhatsApp notice")} skipped.`,
    ...r.people.filter((p) => p.created).map((p) => `Added ${p.name} to your people as "New from WhatsApp", marked for review.`),
    `Import #${r.importId}, times read as ${r.timeZone}.`,
  ];
}

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs({ allowPositionals: true, options: { owner: { type: "string" }, tz: { type: "string" } } });
  } catch {
    console.error(USAGE);
    return 1;
  }
  const [path] = args.positionals;
  if (!path) {
    console.error(USAGE);
    return 1;
  }
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(path);
  } catch {
    console.error(`Cannot read ${path}.`);
    return 1;
  }

  if (!sql) {
    console.error("No usable DATABASE_URL. Set it in .env.local or in front of this command.");
    return 1;
  }
  try {
    const report = await importWhatsAppExport(sql, {
      fileName: basename(path),
      bytes,
      ownerName: args.values.owner,
      timeZone: args.values.tz,
    });
    for (const line of describeReport(report)) console.log(line);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(error instanceof ImportError ? message : `Import failed: ${message}`);
    return 1;
  } finally {
    await sql.end();
  }
}

main().then((code) => {
  process.exitCode = code;
});
