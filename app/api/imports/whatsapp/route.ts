import { sql } from "@/lib/db";
import { loadRoster } from "@/lib/roster";
import { importWhatsAppExport } from "@/lib/whatsapp/import";
import { MAX_EXPORT_BYTES, TOO_LARGE } from "@/lib/whatsapp/limits";
import { ImportError } from "@/lib/whatsapp/parse";

export const maxDuration = 60;

// Room for the multipart boundary and headers around the file.
const MAX_BODY_BYTES = MAX_EXPORT_BYTES + 64 * 1024;

// One WhatsApp export per request, sent as the "file" field of a multipart form.
// Replies with the import report and the roster as it is now, so the page can show a new person without a reload.
export async function POST(req: Request) {
  // Refuse an oversized upload before reading it.
  if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) return Response.json({ error: TOO_LARGE }, { status: 413 });
  if (!sql) return Response.json({ error: "Importing a chat needs a database. Set DATABASE_URL and restart Kobe." }, { status: 404 });
  const file = await req
    .formData()
    .then((form) => form.get("file"))
    .catch(() => null);
  if (!(file instanceof File)) {
    return Response.json({ error: "The upload did not arrive in one piece. Choose the WhatsApp export again." }, { status: 400 });
  }
  if (file.size > MAX_EXPORT_BYTES) return Response.json({ error: TOO_LARGE }, { status: 413 });
  try {
    const report = await importWhatsAppExport(sql, { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    return Response.json({ report, roster: await loadRoster() });
  } catch (error) {
    if (error instanceof ImportError) return Response.json({ error: error.message }, { status: 422 });
    // Never log the error object: a database error can carry the message bodies it was writing.
    const { name, code } = (error ?? {}) as { name?: string; code?: string };
    console.error("[kobe] WhatsApp import failed:", name ?? "unknown error", code ?? "");
    return Response.json({ error: "Kobe could not store this chat. Try again in a moment." }, { status: 500 });
  }
}
